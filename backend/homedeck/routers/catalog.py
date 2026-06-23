"""App-store catalog: browse imported templates + trigger a sync."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..models import User
from ..security import get_current_user
from ..services import catalog_service as csvc

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


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
