"""User-editable settings (Settings page). Catalog sources for now."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..models import User
from ..security import get_current_user
from ..services import settings_service

router = APIRouter(prefix="/api/settings", tags=["settings"])


class CatalogSource(BaseModel):
    kind: str = "portainer"  # portainer | casaos
    url: str = ""
    enabled: bool = True


class CatalogSourcesRequest(BaseModel):
    sources: list[CatalogSource]


@router.get("/catalog-sources")
def get_catalog_sources(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    return {"sources": settings_service.get_catalog_sources()}


@router.put("/catalog-sources")
def set_catalog_sources(
    req: CatalogSourcesRequest, _user: User = Depends(get_current_user)
) -> dict[str, Any]:
    try:
        saved = settings_service.set_catalog_sources([s.model_dump() for s in req.sources])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"sources": saved}
