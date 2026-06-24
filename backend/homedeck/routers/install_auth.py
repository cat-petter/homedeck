"""Manage the app-level install password gating privileged package operations."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..models import User
from ..security import get_current_user
from ..services import install_auth
from ..services.install_auth import InstallAuthError

router = APIRouter(prefix="/api/install-password", tags=["install-password"])


class SetPasswordRequest(BaseModel):
    password: str
    current_password: str | None = None


class VerifyRequest(BaseModel):
    password: str


@router.get("/status")
def status(_user: User = Depends(get_current_user)) -> dict[str, bool]:
    return {"set": install_auth.is_set()}


@router.post("")
def set_password(req: SetPasswordRequest, _user: User = Depends(get_current_user)) -> dict[str, bool]:
    try:
        install_auth.set_password(req.password, req.current_password)
    except InstallAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"set": True}


@router.post("/verify")
def verify(req: VerifyRequest, _user: User = Depends(get_current_user)) -> dict[str, bool]:
    return {"ok": install_auth.verify(req.password)}
