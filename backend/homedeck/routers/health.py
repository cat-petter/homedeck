"""Service health + quick-launch tile management."""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..db import get_session, session_scope
from ..models import Service, ServiceCheckResult, User
from ..security import get_current_user
from ..services import health_service as hsvc
from .docker import _ws_authenticate

router = APIRouter(prefix="/api/health", tags=["health"])

CheckType = Literal["none", "http", "tcp", "ping"]
STATUS_INTERVAL_SECONDS = 5.0


# --- Schemas ----------------------------------------------------------------

class ServiceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str = Field(default="", max_length=60)
    icon: str = Field(default="", max_length=16)
    lan_url: str = Field(default="", max_length=500)
    tailscale_url: str = Field(default="", max_length=500)
    check_type: CheckType = "none"
    check_target: str = Field(default="", max_length=500)
    expected_status: str = Field(default="", max_length=20)
    interval_seconds: int = Field(default=60, ge=5, le=86400)
    timeout_seconds: int = Field(default=10, ge=1, le=120)
    degraded_ms: int | None = Field(default=None, ge=1, le=120000)
    verify_tls: bool = False
    enabled: bool = True
    sort_order: int = 0


class ServiceOut(BaseModel):
    id: int
    name: str
    category: str
    icon: str
    lan_url: str
    tailscale_url: str
    check_type: str
    check_target: str
    expected_status: str
    interval_seconds: int
    timeout_seconds: int
    degraded_ms: int | None
    verify_tls: bool
    enabled: bool
    sort_order: int
    last_status: str
    last_checked_at: str | None
    last_response_ms: float | None
    last_error: str | None
    uptime_24h: float | None


def _to_out(svc: Service) -> ServiceOut:
    return ServiceOut(
        id=svc.id,
        name=svc.name,
        category=svc.category,
        icon=svc.icon,
        lan_url=svc.lan_url,
        tailscale_url=svc.tailscale_url,
        check_type=svc.check_type,
        check_target=svc.check_target,
        expected_status=svc.expected_status,
        interval_seconds=svc.interval_seconds,
        timeout_seconds=svc.timeout_seconds,
        degraded_ms=svc.degraded_ms,
        verify_tls=svc.verify_tls,
        enabled=svc.enabled,
        sort_order=svc.sort_order,
        last_status=svc.last_status,
        last_checked_at=svc.last_checked_at.isoformat() if svc.last_checked_at else None,
        last_response_ms=svc.last_response_ms,
        last_error=svc.last_error,
        uptime_24h=hsvc.uptime_pct(svc.id, 24.0),
    )


def _list_services(db: Session) -> list[Service]:
    return db.exec(select(Service).order_by(Service.sort_order, Service.name)).all()


# --- CRUD -------------------------------------------------------------------

@router.get("/services", response_model=list[ServiceOut])
def list_services(_user: User = Depends(get_current_user), db: Session = Depends(get_session)) -> list[ServiceOut]:
    return [_to_out(s) for s in _list_services(db)]


@router.post("/services", response_model=ServiceOut, status_code=status.HTTP_201_CREATED)
def create_service(
    payload: ServiceIn, _user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> ServiceOut:
    svc = Service(**payload.model_dump())
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return _to_out(svc)


@router.put("/services/{service_id}", response_model=ServiceOut)
def update_service(
    service_id: int,
    payload: ServiceIn,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> ServiceOut:
    svc = db.get(Service, service_id)
    if svc is None:
        raise HTTPException(status_code=404, detail="Service not found")
    for k, v in payload.model_dump().items():
        setattr(svc, k, v)
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return _to_out(svc)


@router.delete("/services/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_service(
    service_id: int, _user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> Response:
    svc = db.get(Service, service_id)
    if svc is None:
        raise HTTPException(status_code=404, detail="Service not found")
    # Remove history first (no DB-level cascade configured).
    for r in db.exec(select(ServiceCheckResult).where(ServiceCheckResult.service_id == service_id)).all():
        db.delete(r)
    db.delete(svc)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/services/{service_id}/check", response_model=ServiceOut)
async def check_service_now(
    service_id: int, _user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> ServiceOut:
    try:
        await hsvc.check_now(service_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    db.expire_all()
    svc = db.get(Service, service_id)
    return _to_out(svc)


@router.get("/services/{service_id}/history")
def service_history(
    service_id: int,
    hours: float = Query(default=24.0, gt=0, le=168.0),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    if db.get(Service, service_id) is None:
        raise HTTPException(status_code=404, detail="Service not found")
    return hsvc.get_history(service_id, hours)


# --- Live status WebSocket --------------------------------------------------

@router.websocket("/ws")
async def ws_status(websocket: WebSocket) -> None:
    await websocket.accept()
    user = await _ws_authenticate(websocket)
    if user is None:
        await websocket.close(code=4401)
        return

    def _snapshot() -> list[dict[str, Any]]:
        with session_scope() as db:
            return [_to_out(s).model_dump() for s in _list_services(db)]

    try:
        while True:
            services = await asyncio.to_thread(_snapshot)
            await websocket.send_json({"type": "services", "services": services})
            await asyncio.sleep(STATUS_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        return
    except RuntimeError:
        return
