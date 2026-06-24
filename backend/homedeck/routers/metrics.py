"""System metrics: current snapshot, history, and a live WebSocket feed."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from ..models import User
from ..security import authenticate_websocket, get_current_user
from ..services import metrics_service as msvc

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/current")
def current(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    return msvc.latest()


@router.get("/history")
def history(
    hours: float = Query(default=24.0, gt=0, le=24.0),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return {"hours": hours, "samples": msvc.get_history(hours)}


@router.get("/processes")
def processes(
    limit: int = Query(default=10, ge=1, le=50),
    sort: str = Query(default="cpu", pattern="^(cpu|mem)$"),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    # Blocking ~0.35s (CPU delta sampling); sync handler runs in the threadpool.
    return {"sort": sort, "processes": msvc.top_processes(limit=limit, sort=sort)}


@router.websocket("/ws")
async def ws_metrics(websocket: WebSocket) -> None:
    await websocket.accept()
    user = await authenticate_websocket(websocket)
    if user is None:
        await websocket.close(code=4401)
        return
    try:
        while True:
            await websocket.send_json({"type": "snapshot", "data": msvc.latest()})
            await asyncio.sleep(msvc.LIVE_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        return
    except RuntimeError:
        return
