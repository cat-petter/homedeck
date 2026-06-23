"""Catalog importer: fetch public app templates and normalize them into one
internal schema, stored in SQLite for browse/search.

Currently imports Portainer-format template lists (both the v2 int-`type`
encoding and the v3 string-`type` encoding). CasaOS is added in a later step.
Sync is idempotent: templates are upserted by a stable per-source id. Source
attribution is retained on every row. Cross-source dedup/merge is the next step.
"""

from __future__ import annotations

import json
import re
import urllib.request
from typing import Any

from sqlmodel import select

from ..config import get_settings
from ..db import session_scope
from ..models import CatalogTemplate, utcnow
from .app_metadata import parse_image

_settings = get_settings()
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    return _SLUG_RE.sub("-", (text or "").lower()).strip("-") or "app"


def _fetch_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "HomeDeck-catalog/1.0"})
    with urllib.request.urlopen(req, timeout=_settings.catalog.fetch_timeout_seconds) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


# --- Portainer normalization ------------------------------------------------

def _norm_kind(raw_type: Any) -> str:
    if isinstance(raw_type, int):
        return "container" if raw_type == 1 else "stack"
    if isinstance(raw_type, str):
        return "container" if raw_type in ("1", "container") else "stack"
    return "container"


def _parse_ports(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in raw or []:
        if isinstance(p, dict):
            for k, v in p.items():
                cport, _, proto = str(k).partition("/")
                out.append({"container_port": cport, "host_port": str(v) if v else None, "protocol": proto or "tcp"})
            continue
        s = str(p)
        proto = "tcp"
        if "/" in s:
            s, proto = s.rsplit("/", 1)
        if ":" in s:
            host, cont = s.split(":", 1)
        else:
            host, cont = None, s
        out.append({"container_port": cont, "host_port": host, "protocol": proto or "tcp"})
    return out


def _parse_volumes(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for v in raw or []:
        if isinstance(v, dict):
            bind = v.get("bind")
            out.append(
                {
                    "container_path": v.get("container") or bind or "",
                    "bind": bind,
                    "readonly": bool(v.get("readonly")),
                    "type": "bind" if bind else "volume",
                }
            )
        else:
            s = str(v)
            if ":" in s:
                bind, cont = s.split(":", 1)
                out.append({"container_path": cont, "bind": bind, "readonly": False, "type": "bind"})
            else:
                out.append({"container_path": s, "bind": None, "readonly": False, "type": "volume"})
    return out


def _parse_env(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for e in raw or []:
        if not isinstance(e, dict) or not e.get("name"):
            continue
        select_opts = e.get("select")
        options = None
        default = e.get("default")
        if isinstance(select_opts, list):
            options = [{"text": o.get("text", o.get("value")), "value": o.get("value")} for o in select_opts]
            if default is None:
                default = next((o.get("value") for o in select_opts if o.get("default")), None)
        out.append(
            {
                "name": e["name"],
                "label": e.get("label") or e["name"],
                "description": e.get("description", ""),
                "default": "" if default is None else str(default),
                "preset": bool(e.get("preset")),
                "required": not e.get("preset") and (default in (None, "")),
                "options": options,
            }
        )
    return out


def _image_key(image: str) -> str:
    if not image:
        return ""
    p = parse_image(image)
    return f"{p['registry']}/{p['repository']}"


def normalize_portainer(t: dict[str, Any], source_url: str) -> dict[str, Any] | None:
    name = t.get("title") or t.get("name") or ""
    image = t.get("image") or ""
    if not name and not image:
        return None
    kind = _norm_kind(t.get("type"))
    slug = _slugify(name) if name else _slugify(parse_image(image)["slug"])

    spec = {
        "ports": _parse_ports(t.get("ports")),
        "volumes": _parse_volumes(t.get("volumes")),
        "env": _parse_env(t.get("env")),
        "restart_policy": t.get("restart_policy") or "",
        "command": t.get("command") or "",
        "network": t.get("network") or "",
        "hostname": t.get("hostname") or "",
        "privileged": bool(t.get("privileged")),
        "repository": t.get("repository") or None,  # stack templates
        "platform": t.get("platform") or "",
        "note": t.get("note") or "",
    }
    return {
        "id": f"portainer:{slug}",
        "source": "portainer",
        "source_url": source_url,
        "name": name or parse_image(image)["slug"],
        "description": t.get("description", ""),
        "logo": t.get("logo", ""),
        "image": image,
        "image_key": _image_key(image),
        "kind": kind,
        "categories": t.get("categories") or [],
        "spec": spec,
        "sources": [{"catalog": "portainer", "url": source_url}],
    }


def _extract_portainer_list(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, dict):
        return data.get("templates") or []
    if isinstance(data, list):
        return data
    return []


# --- Sync -------------------------------------------------------------------

def sync() -> dict[str, Any]:
    """Fetch all configured sources, normalize, and upsert. Idempotent."""
    summary: dict[str, Any] = {"imported": 0, "updated": 0, "skipped": 0, "sources": [], "errors": []}
    normalized: dict[str, dict[str, Any]] = {}

    for url in _settings.catalog.portainer_template_urls:
        try:
            data = _fetch_json(url)
            raw_list = _extract_portainer_list(data)
            count = 0
            for t in raw_list:
                norm = normalize_portainer(t, url)
                if norm is None:
                    summary["skipped"] += 1
                    continue
                # Last source wins on id collision within this sync run.
                normalized[norm["id"]] = norm
                count += 1
            summary["sources"].append({"source": "portainer", "url": url, "templates": count})
        except Exception as exc:  # noqa: BLE001 - surface fetch/parse errors verbatim
            summary["errors"].append({"url": url, "error": str(exc)})

    with session_scope() as db:
        existing_ids = {t.id for t in db.exec(select(CatalogTemplate)).all()}
        for tid, norm in normalized.items():
            row = db.get(CatalogTemplate, tid)
            if row is None:
                row = CatalogTemplate(id=tid)
                summary["imported"] += 1
            else:
                summary["updated"] += 1
            row.source = norm["source"]
            row.source_url = norm["source_url"]
            row.name = norm["name"]
            row.description = norm["description"]
            row.logo = norm["logo"]
            row.image = norm["image"]
            row.image_key = norm["image_key"]
            row.kind = norm["kind"]
            row.categories = norm["categories"]
            row.spec = norm["spec"]
            row.sources = norm["sources"]
            row.updated_at = utcnow()
            db.add(row)
        db.commit()

    summary["total"] = len(normalized)
    return summary


# --- Queries ----------------------------------------------------------------

def _to_dict(t: CatalogTemplate) -> dict[str, Any]:
    return {
        "id": t.id,
        "source": t.source,
        "source_url": t.source_url,
        "name": t.name,
        "description": t.description,
        "logo": t.logo,
        "image": t.image,
        "image_key": t.image_key,
        "kind": t.kind,
        "categories": t.categories,
        "spec": t.spec,
        "sources": t.sources,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def list_templates(
    search: str = "",
    category: str = "",
    source: str = "",
    limit: int = 60,
    offset: int = 0,
) -> dict[str, Any]:
    with session_scope() as db:
        rows = db.exec(select(CatalogTemplate)).all()
    items = [_to_dict(t) for t in rows]
    if search:
        s = search.lower()
        items = [i for i in items if s in i["name"].lower() or s in i["description"].lower()]
    if category:
        items = [i for i in items if category in (i["categories"] or [])]
    if source:
        items = [i for i in items if i["source"] == source]
    items.sort(key=lambda i: i["name"].lower())
    total = len(items)
    page = items[offset : offset + limit]
    # Trim heavy spec from list payloads; detail endpoint returns the full thing.
    for i in page:
        i.pop("spec", None)
    return {"total": total, "items": page}


def get_template(template_id: str) -> dict[str, Any] | None:
    with session_scope() as db:
        t = db.get(CatalogTemplate, template_id)
        return _to_dict(t) if t else None


def categories() -> list[dict[str, Any]]:
    with session_scope() as db:
        rows = db.exec(select(CatalogTemplate)).all()
    counts: dict[str, int] = {}
    for t in rows:
        for c in t.categories or []:
            counts[c] = counts.get(c, 0) + 1
    return sorted(({"name": k, "count": v} for k, v in counts.items()), key=lambda c: c["name"].lower())


def status() -> dict[str, Any]:
    with session_scope() as db:
        rows = db.exec(select(CatalogTemplate)).all()
    last = max((t.updated_at for t in rows), default=None)
    by_source: dict[str, int] = {}
    for t in rows:
        by_source[t.source] = by_source.get(t.source, 0) + 1
    return {"total": len(rows), "last_synced": last.isoformat() if last else None, "by_source": by_source}
