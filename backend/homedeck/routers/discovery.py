"""Discover web UIs of existing containers and propose quick-launch tiles."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..models import User
from ..security import get_current_user
from ..services import discovery as dsvc
from ..services.docker_service import DockerUnavailable

router = APIRouter(prefix="/api/discovery", tags=["discovery"])


@router.get("/suggestions")
async def suggestions(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return {"suggestions": await dsvc.discover()}
    except DockerUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Docker daemon unreachable: {exc}")
