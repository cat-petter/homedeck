"""User-editable settings (Settings page), layered over the file/env config.

Currently: catalog sources. Each source is {kind, url, enabled}; the effective
list is the DB override if the user has saved one, else seeded from config
defaults (the built-in Portainer lists + CasaOS, off by default). This is what
makes every source opt-in/toggleable from the UI.
"""

from __future__ import annotations

import json
from typing import Any

from ..config import get_settings
from . import app_settings

_SOURCES_KEY = "catalog_sources"
CASAOS_URL = "https://github.com/IceWhaleTech/CasaOS-AppStore"


def _default_sources() -> list[dict[str, Any]]:
    cfg = get_settings().catalog
    out: list[dict[str, Any]] = [
        {"kind": "portainer", "url": u, "enabled": True} for u in cfg.portainer_template_urls
    ]
    out.append({"kind": "casaos", "url": CASAOS_URL, "enabled": cfg.enable_casaos})
    return out


def _norm(s: dict[str, Any]) -> dict[str, Any]:
    kind = "casaos" if s.get("kind") == "casaos" else "portainer"
    url = CASAOS_URL if kind == "casaos" else str(s.get("url") or "").strip()
    return {"kind": kind, "url": url, "enabled": bool(s.get("enabled", True))}


def get_catalog_sources() -> list[dict[str, Any]]:
    raw = app_settings.get_setting(_SOURCES_KEY)
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return [_norm(s) for s in data if isinstance(s, dict)]
        except ValueError:
            pass
    return _default_sources()


def set_catalog_sources(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    seen: set[tuple] = set()
    for s in sources:
        n = _norm(s)
        if n["kind"] == "portainer":
            if not (n["url"].startswith("http://") or n["url"].startswith("https://")):
                raise ValueError(f"Source URL must be http(s): {n['url']!r}")
            key = ("portainer", n["url"])
        else:
            key = ("casaos",)
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(n)
    app_settings.set_setting(_SOURCES_KEY, json.dumps(cleaned))
    return cleaned
