"""App-store catalog: browse imported templates + trigger a sync."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..models import User
from ..security import get_current_user
from ..services import catalog_service as csvc
from ..services import compose_service as compose
from ..services import stack_service
from ..services.stack_service import StackError

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


class RenderRequest(BaseModel):
    template_id: str
    config: dict[str, Any]


@router.get("/status")
def status(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    return csvc.status()


@router.get("/templates")
def list_templates(
    search: str = "",
    category: str = "",
    source: str = "",
    limit: int = Query(default=60, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return csvc.list_templates(search=search, category=category, source=source, limit=limit, offset=offset)


@router.get("/categories")
def categories(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    return {"categories": csvc.categories()}


@router.get("/stack-compose")
async def stack_compose(template_id: str, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    # Query param (not a path segment) so it doesn't collide with the greedy
    # /templates/{id:path} route below.
    try:
        return await asyncio.to_thread(stack_service.get_compose, template_id)
    except StackError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/templates/{template_id:path}")
def get_template(template_id: str, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    t = csvc.get_template(template_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return t


@router.post("/sync")
async def sync(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    # Network fetch can take a few seconds; run off the event loop.
    return await asyncio.to_thread(csvc.sync)


@router.post("/render")
def render(req: RenderRequest, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    # template_id is optional context for deriving required env; the config
    # itself carries the image (with separate tag).
    t = csvc.get_template(req.template_id) if req.template_id else None
    required = [e["name"] for e in (t.get("spec") or {}).get("env", []) if e.get("required")] if t else []
    compose_dict = compose.render_compose(req.config)
    return {
        "compose_yaml": compose.to_yaml(compose_dict),
        "validation": compose.validate(req.config, required_env=required),
    }
