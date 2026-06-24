"""Installed apps: deploy from the catalog, then start/stop/reconfigure/remove."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..models import User
from ..security import get_current_user
from ..services import app_service as asvc
from ..services import catalog_service as csvc
from ..services.app_service import DeployError

router = APIRouter(prefix="/api/apps", tags=["apps"])


class DeployRequest(BaseModel):
    template_id: str = ""
    config: dict[str, Any]


class DeployComposeRequest(BaseModel):
    name: str
    compose_yaml: str
    title: str = ""
    icon: str = ""
    web_ui_lan: str = ""
    web_ui_tailscale: str = ""
    template_id: str = ""


class ReconfigureRequest(BaseModel):
    config: dict[str, Any]


def _required_env(template_id: str) -> list[str]:
    t = csvc.get_template(template_id) if template_id else None
    if not t:
        return []
    return [e["name"] for e in (t.get("spec") or {}).get("env", []) if e.get("required")]


@router.get("")
async def list_apps(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    return {"apps": await asyncio.to_thread(asvc.list_apps)}


@router.get("/{app_id}")
async def get_app(app_id: int, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    app = await asyncio.to_thread(asvc.get_app, app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="App not found")
    return app


@router.post("/deploy")
async def deploy(req: DeployRequest, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(
            asvc.deploy, req.template_id, req.config, _required_env(req.template_id)
        )
    except DeployError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "output": exc.output})


@router.post("/deploy-compose")
async def deploy_compose(req: DeployComposeRequest, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(
            asvc.deploy_compose,
            req.name,
            req.compose_yaml,
            title=req.title,
            icon=req.icon,
            web_ui_lan=req.web_ui_lan,
            web_ui_tailscale=req.web_ui_tailscale,
            template_id=req.template_id,
        )
    except DeployError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "output": exc.output})


@router.post("/{app_id}/reconfigure")
async def reconfigure(app_id: int, req: ReconfigureRequest, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    app = await asyncio.to_thread(asvc.get_app, app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="App not found")
    try:
        return await asyncio.to_thread(
            asvc.redeploy, app_id, req.config, _required_env(app.get("template_id", ""))
        )
    except DeployError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "output": exc.output})


@router.post("/{app_id}/start")
async def start_app(app_id: int, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(asvc.set_running, app_id, True)
    except DeployError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "output": exc.output})


@router.post("/{app_id}/stop")
async def stop_app(app_id: int, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(asvc.set_running, app_id, False)
    except DeployError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "output": exc.output})


@router.delete("/{app_id}")
async def remove_app(
    app_id: int,
    delete_data: bool = Query(default=False, description="Also remove named volumes (-v)"),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(asvc.remove, app_id, delete_data=delete_data)
    except DeployError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "output": exc.output})
