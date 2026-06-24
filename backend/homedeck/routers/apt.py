"""APT app store: browse the host package universe (read-only, Phase 6 part 1).

Install/remove/upgrade land later behind the scoped sudoers helper + install
password.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..models import User
from ..security import get_current_user
from ..services import apt_service as asvc

router = APIRouter(prefix="/api/apt", tags=["apt"])


@router.get("/status")
async def status(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    return await asyncio.to_thread(asvc.status)


@router.get("/packages")
async def packages(
    search: str = "",
    installed: bool = False,
    upgradable: bool = False,
    limit: int = Query(default=60, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return await asyncio.to_thread(
        asvc.search, search, installed, upgradable, limit, offset
    )


@router.get("/packages/{name}")
async def package(name: str, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    detail = await asyncio.to_thread(asvc.package_detail, name)
    if detail is None:
        raise HTTPException(status_code=404, detail="Package not found")
    return detail
