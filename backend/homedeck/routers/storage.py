"""Storage breakdown endpoints (Docker usage, filesystems, largest directories)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..models import User
from ..security import get_current_user
from ..services import storage_service as ssvc
from ..services.docker_service import DockerUnavailable

router = APIRouter(prefix="/api/storage", tags=["storage"])


@router.get("/docker")
def docker_usage(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return ssvc.docker_usage()
    except DockerUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Docker daemon unreachable: {exc}")


@router.get("/filesystems")
def filesystems(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    return {"filesystems": ssvc.filesystems()}


@router.get("/directories")
def directories(
    path: str = Query(default="/"),
    limit: int = Query(default=40, ge=1, le=200),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    # Blocking directory walk; sync handler runs in the threadpool.
    try:
        return ssvc.directory_breakdown(path=path, limit=limit)
    except NotADirectoryError:
        raise HTTPException(status_code=404, detail=f"Not a directory: {path}")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
