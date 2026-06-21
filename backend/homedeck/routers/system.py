"""System / connectivity info endpoints (Phase 1 baseline)."""

from __future__ import annotations

import platform

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import __version__
from ..models import User
from ..security import get_current_user
from ..services.net import get_connectivity

router = APIRouter(prefix="/api/system", tags=["system"])


class ConnectivityOut(BaseModel):
    hostname: str
    lan_ip: str | None
    tailscale_ip: str | None
    tailscale_dns: str | None
    tailscale_available: bool


class SystemInfoOut(BaseModel):
    app_version: str
    hostname: str
    platform: str
    python_version: str
    connectivity: ConnectivityOut


@router.get("/info", response_model=SystemInfoOut)
def system_info(_user: User = Depends(get_current_user)) -> SystemInfoOut:
    conn = get_connectivity()
    return SystemInfoOut(
        app_version=__version__,
        hostname=conn.hostname,
        platform=platform.platform(),
        python_version=platform.python_version(),
        connectivity=ConnectivityOut(
            hostname=conn.hostname,
            lan_ip=conn.lan_ip,
            tailscale_ip=conn.tailscale_ip,
            tailscale_dns=conn.tailscale_dns,
            tailscale_available=conn.tailscale_available,
        ),
    )
