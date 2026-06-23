"""Docker Hub fallback: search images, inspect a repo, check image freshness."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..models import User
from ..security import get_current_user
from ..services import dockerhub_service as hub
from ..services.dockerhub_service import HubError

router = APIRouter(prefix="/api/hub", tags=["dockerhub"])


@router.get("/search")
async def search(
    q: str = Query(default=""),
    limit: int = Query(default=25, ge=1, le=100),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(hub.search, q, limit)
    except HubError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/image-status")
async def image_status(
    image: str = Query(...),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return await asyncio.to_thread(hub.image_status, image)


@router.get("/repos/{repo:path}/tags")
async def tags(
    repo: str,
    limit: int = Query(default=25, ge=1, le=100),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        return {"tags": await asyncio.to_thread(hub.get_tags, repo, limit)}
    except HubError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/repos/{repo:path}")
async def inspect(repo: str, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(hub.inspect, repo)
    except HubError as exc:
        code = 404 if "404" in str(exc) else 502
        raise HTTPException(status_code=code, detail=str(exc))
