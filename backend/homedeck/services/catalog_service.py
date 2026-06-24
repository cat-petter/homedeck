"""Catalog importer + normalization/dedup pipeline.

Sources (Portainer template lists; CasaOS AppStore when enabled) are each
normalized into one internal schema, then run through a dedup pipeline:

  - Match key = image_key (registry+repo, tag stripped).
  - Merge true duplicates (same image_key) into one canonical template: union
    ports/env/volumes by key, prefer richer non-empty fields, keep a sources[]
    array, and record conflicting env defaults rather than dropping them.
  - Variants (same app name, different image — official vs linuxserver) are NOT
    merged; they share an app_group and are presented as alternatives.

Normalize FORMAT only — never auto-change defaults/ports. Idempotent re-sync.
"""

from __future__ import annotations

import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import yaml
from sqlmodel import select

from ..config import get_settings
from ..db import session_scope
from ..models import CatalogTemplate, utcnow
from .app_metadata import parse_image

_settings = get_settings()
_SLUG_RE = re.compile(r"[^a-z0-9]+")
_CASAOS_REPO = "IceWhaleTech/CasaOS-AppStore"
_CASAOS_RAW = f"https://raw.githubusercontent.com/{_CASAOS_REPO}/main/"


def _slugify(text: str) -> str:
    return _SLUG_RE.sub("-", (text or "").lower()).strip("-") or "app"


def _fetch_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "HomeDeck-catalog/1.0"})
    with urllib.request.urlopen(req, timeout=_settings.catalog.fetch_timeout_seconds) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def _image_key(image: str) -> str:
    if not image:
        return ""
    p = parse_image(image)
    return f"{p['registry']}/{p['repository']}"


# --- Shared parsers (Portainer string forms) --------------------------------

def _parse_ports(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in raw or []:
        if isinstance(p, dict) and "target" not in p:
            for k, v in p.items():
                cport, _, proto = str(k).partition("/")
                out.append({"container_port": cport, "host_port": str(v) if v else None, "protocol": proto or "tcp"})
            continue
        if isinstance(p, dict):  # compose long form
            host = p.get("published")
            out.append(
                {
                    "container_port": str(p.get("target", "")),
                    "host_port": str(host) if host not in (None, "") else None,
                    "protocol": p.get("protocol", "tcp") or "tcp",
                }
            )
            continue
        s = str(p)
        proto = "tcp"
        if "/" in s:
            s, proto = s.rsplit("/", 1)
        host, cont = (s.split(":", 1) + [None])[:2] if ":" in s else (None, s)
        out.append({"container_port": cont, "host_port": host, "protocol": proto or "tcp"})
    return out


def _parse_volumes(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for v in raw or []:
        if isinstance(v, dict):
            bind = v.get("bind") or v.get("source")
            target = v.get("container") or v.get("target") or bind or ""
            out.append(
                {
                    "container_path": target,
                    "bind": bind,
                    "readonly": bool(v.get("readonly") or v.get("read_only")),
                    "type": (v.get("type") or ("bind" if bind else "volume")),
                }
            )
        else:
            s = str(v)
            if ":" in s:
                bind, cont = s.split(":", 1)
                cont = cont.split(":", 1)[0]  # drop :ro suffix
                out.append({"container_path": cont, "bind": bind, "readonly": s.endswith(":ro"), "type": "bind"})
            else:
                out.append({"container_path": s, "bind": None, "readonly": False, "type": "volume"})
    return out


def _parse_env_portainer(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for e in raw or []:
        if not isinstance(e, dict) or not e.get("name"):
            continue
        select_opts = e.get("select")
        options = None
        default = e.get("default")
        # Portainer's `set` is a fixed preset value (not user-configurable). Treat
        # it as a preset default so the var carries its value and isn't flagged
        # as a required-but-empty field.
        set_val = e.get("set")
        is_preset = bool(e.get("preset")) or set_val is not None
        if set_val is not None and default is None:
            default = set_val
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
                "preset": is_preset,
                "required": not is_preset and (default in (None, "")),
                "options": options,
            }
        )
    return out


def _parse_env_compose(raw: Any) -> list[dict[str, Any]]:
    items: list[tuple[str, Any]] = []
    if isinstance(raw, dict):
        items = list(raw.items())
    elif isinstance(raw, list):
        for e in raw:
            if isinstance(e, str):
                k, _, v = e.partition("=")
                items.append((k, v))
    out = []
    for k, v in items:
        out.append(
            {"name": k, "label": k, "description": "", "default": "" if v is None else str(v), "preset": False, "required": False, "options": None}
        )
    return out


# --- Portainer normalization ------------------------------------------------

def _norm_kind(raw_type: Any) -> str:
    if isinstance(raw_type, int):
        return "container" if raw_type == 1 else "stack"
    if isinstance(raw_type, str):
        return "container" if raw_type in ("1", "container") else "stack"
    return "container"


def normalize_portainer(t: dict[str, Any], source_url: str) -> dict[str, Any] | None:
    name = t.get("title") or t.get("name") or ""
    image = t.get("image") or ""
    if not name and not image:
        return None
    slug = _slugify(name) if name else _slugify(parse_image(image)["slug"])
    spec = {
        "ports": _parse_ports(t.get("ports")),
        "volumes": _parse_volumes(t.get("volumes")),
        "env": _parse_env_portainer(t.get("env")),
        "restart_policy": t.get("restart_policy") or "",
        "command": t.get("command") or "",
        "network": t.get("network") or "",
        "hostname": t.get("hostname") or "",
        "privileged": bool(t.get("privileged")),
        "repository": t.get("repository") or None,
        "platform": t.get("platform") or "",
        "note": t.get("note") or "",
        "web_port": "",
    }
    return {
        "id": f"portainer:{slug}",
        "source": "portainer",
        "source_url": source_url,
        "name": name or parse_image(image)["slug"],
        # `or ""` (not get-default): some sources ship `"description": null`,
        # and the column is NOT NULL.
        "description": t.get("description") or "",
        "logo": t.get("logo") or "",
        "image": image,
        "image_key": _image_key(image),
        "kind": _norm_kind(t.get("type")),
        "categories": t.get("categories") or [],
        "spec": spec,
        "sources": [{"catalog": "portainer", "url": source_url}],
    }


def _extract_portainer_list(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, dict):
        return data.get("templates") or []
    return data if isinstance(data, list) else []


def fetch_portainer(url: str) -> list[dict[str, Any]]:
    data = _fetch_json(url)
    out = []
    for t in _extract_portainer_list(data):
        norm = normalize_portainer(t, url)
        if norm:
            out.append(norm)
    return out


# --- CasaOS normalization ---------------------------------------------------

def _pick_lang(v: Any) -> str:
    if isinstance(v, dict):
        return v.get("en_us") or v.get("en") or (next(iter(v.values()), "") if v else "")
    return v or ""


def normalize_casaos(app_name: str, compose: Any, source_url: str) -> dict[str, Any] | None:
    if not isinstance(compose, dict):
        return None
    xc = compose.get("x-casaos") or {}
    services = compose.get("services") or {}
    main_name = xc.get("main") or (next(iter(services)) if services else None)
    main = (services.get(main_name) or {}) if main_name else {}
    image = main.get("image", "")
    if not image:
        return None
    name = _pick_lang(xc.get("title")) or app_name
    desc = _pick_lang(xc.get("description")) or _pick_lang(xc.get("tagline")) or ""
    category = xc.get("category", "") or ""
    multi = len(services) > 1
    spec = {
        "ports": _parse_ports(main.get("ports")),
        "volumes": _parse_volumes(main.get("volumes")),
        "env": _parse_env_compose(main.get("environment")),
        "restart_policy": main.get("restart", "") or "",
        "command": main.get("command", "") or "",
        "network": main.get("network_mode", "") or "",
        "hostname": main.get("hostname", "") or "",
        "privileged": bool(main.get("privileged")),
        "repository": None,
        "platform": "",
        "note": "Multi-service CasaOS app" if multi else "",
        "web_port": str(xc.get("port_map", "") or ""),
    }
    slug = _slugify(name)
    return {
        "id": f"casaos:{slug}",
        "source": "casaos",
        "source_url": source_url,
        "name": name,
        "description": desc,
        "logo": xc.get("icon", "") or "",
        "image": image,
        "image_key": _image_key(image),
        "kind": "stack" if multi else "container",
        "categories": [category] if category else [],
        "spec": spec,
        "sources": [{"catalog": "casaos", "url": source_url}],
    }


def fetch_casaos() -> list[dict[str, Any]]:
    """List Apps/*/docker-compose.yml via the git trees API, fetch each raw file."""
    tree = _fetch_json(f"https://api.github.com/repos/{_CASAOS_REPO}/git/trees/main?recursive=1")
    paths = [
        n["path"]
        for n in (tree.get("tree") or [])
        if n.get("type") == "blob"
        and n["path"].startswith("Apps/")
        and n["path"].endswith(("docker-compose.yml", "docker-compose.yaml"))
    ]
    src_url = f"https://github.com/{_CASAOS_REPO}"

    def fetch_one(path: str) -> dict[str, Any] | None:
        try:
            req = urllib.request.Request(_CASAOS_RAW + path, headers={"User-Agent": "HomeDeck-catalog/1.0"})
            with urllib.request.urlopen(req, timeout=_settings.catalog.fetch_timeout_seconds) as r:
                compose = yaml.safe_load(r.read().decode("utf-8", "replace"))
            return normalize_casaos(path.split("/")[1], compose, src_url)
        except Exception:  # noqa: BLE001 - skip an app that won't fetch/parse
            return None

    out: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=16) as ex:
        for r in ex.map(fetch_one, paths):
            if r:
                out.append(r)
    return out


# --- Dedup / merge pipeline --------------------------------------------------

def _richness(spec: dict[str, Any], logo: str, desc: str) -> int:
    return (
        len(spec.get("env", [])) * 2
        + len(spec.get("ports", []))
        + len(spec.get("volumes", []))
        + (2 if logo else 0)
        + (1 if len(desc) > 20 else 0)
    )


def _merge_specs(specs: list[dict[str, Any]], canonical: dict[str, Any]) -> dict[str, Any]:
    merged = dict(canonical)
    ports: dict[tuple, dict] = {}
    for sp in specs:
        for p in sp.get("ports", []):
            ports.setdefault((p["container_port"], p["protocol"]), p)
    merged["ports"] = list(ports.values())

    env: dict[str, dict] = {}
    for sp in specs:
        for e in sp.get("env", []):
            k = e["name"]
            if k not in env:
                env[k] = dict(e)
            elif e.get("default") and e["default"] != env[k].get("default"):
                alts = env[k].setdefault("alt_defaults", [])
                if e["default"] not in alts:
                    alts.append(e["default"])
    merged["env"] = list(env.values())

    vols: dict[str, dict] = {}
    for sp in specs:
        for v in sp.get("volumes", []):
            vols.setdefault(v["container_path"], v)
    merged["volumes"] = list(vols.values())
    return merged


def _merge_group(entries: list[dict[str, Any]]) -> dict[str, Any]:
    canonical = max(entries, key=lambda e: _richness(e["spec"], e.get("logo", ""), e.get("description", "")))
    out = dict(canonical)
    out["logo"] = next((e["logo"] for e in entries if e.get("logo")), "")
    out["description"] = max((e.get("description") or "" for e in entries), key=len)
    cats: list[str] = []
    for e in entries:
        for c in e.get("categories", []):
            if c not in cats:
                cats.append(c)
    out["categories"] = cats
    out["spec"] = _merge_specs([e["spec"] for e in entries], canonical["spec"])
    srcs: list[dict] = []
    for e in entries:
        for s in e.get("sources", []):
            if s not in srcs:
                srcs.append(s)
    out["sources"] = srcs
    return out


def _canonical_id(image_key: str, fallback_id: str) -> str:
    if image_key:
        return "app:" + _SLUG_RE.sub("-", image_key.lower()).strip("-")
    return fallback_id


def dedup(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Entries with a derivable image are grouped by image_key (true duplicates).
    # Image-less entries (compose "stacks") have no fingerprint, so group them by
    # their fallback id — the same stack app from different source lists shares
    # one id, and we merge instead of letting them collide on DB upsert.
    by_key: dict[str, list[dict]] = {}
    by_id: dict[str, list[dict]] = {}
    for e in entries:
        if e.get("image_key"):
            by_key.setdefault(e["image_key"], []).append(e)
        else:
            by_id.setdefault(e["id"], []).append(e)

    canon: list[dict[str, Any]] = []
    for key, group in by_key.items():
        merged = _merge_group(group) if len(group) > 1 else dict(group[0])
        merged["id"] = _canonical_id(key, merged["id"])
        canon.append(merged)
    for fid, group in by_id.items():
        merged = _merge_group(group) if len(group) > 1 else dict(group[0])
        merged["id"] = fid  # keep the shared fallback id
        canon.append(merged)
    for c in canon:
        c["app_group"] = _slugify(c["name"])
    return canon


# --- Sync -------------------------------------------------------------------

def sync() -> dict[str, Any]:
    summary: dict[str, Any] = {"imported": 0, "updated": 0, "skipped": 0, "merged": 0, "variant_groups": 0, "sources": [], "errors": []}
    entries: list[dict[str, Any]] = []

    # Effective sources come from the Settings page (DB) if configured, else the
    # config defaults. Each is toggleable, so we only fetch enabled ones.
    from . import settings_service

    for src in settings_service.get_catalog_sources():
        if not src.get("enabled"):
            continue
        try:
            if src["kind"] == "casaos":
                got = fetch_casaos()
                label = settings_service.CASAOS_URL
            else:
                got = fetch_portainer(src["url"])
                label = src["url"]
            entries.extend(got)
            summary["sources"].append({"source": src["kind"], "url": label, "templates": len(got)})
        except Exception as exc:  # noqa: BLE001 - surface fetch/parse errors verbatim
            summary["errors"].append({"url": src.get("url") or src["kind"], "error": str(exc)})

    canon = dedup(entries)
    summary["merged"] = len(entries) - len(canon)

    groups: dict[str, set] = {}
    for c in canon:
        groups.setdefault(c["app_group"], set()).add(c.get("image_key") or c["id"])
    summary["variant_groups"] = sum(1 for keys in groups.values() if len(keys) > 1)

    with session_scope() as db:
        existing = {t.id for t in db.exec(select(CatalogTemplate)).all()}
        new_ids = {c["id"] for c in canon}
        for tid in existing - new_ids:
            row = db.get(CatalogTemplate, tid)
            if row:
                db.delete(row)
        for c in canon:
            row = db.get(CatalogTemplate, c["id"])
            if row is None:
                row = CatalogTemplate(id=c["id"])
                summary["imported"] += 1
            else:
                summary["updated"] += 1
            # NOT NULL string columns: coerce None defensively regardless of source.
            row.source = c["source"]
            row.source_url = c["source_url"] or ""
            row.name = c["name"] or ""
            row.description = c["description"] or ""
            row.logo = c["logo"] or ""
            row.image = c["image"] or ""
            row.image_key = c["image_key"]
            row.app_group = c["app_group"]
            row.kind = c["kind"]
            row.categories = c["categories"]
            row.spec = c["spec"]
            row.sources = c["sources"]
            row.updated_at = utcnow()
            db.add(row)
        db.commit()

    summary["total"] = len(canon)
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
        "app_group": t.app_group,
        "kind": t.kind,
        "categories": t.categories,
        "spec": t.spec,
        "sources": t.sources,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def _app_from_variants(variants: list[CatalogTemplate]) -> dict[str, Any]:
    primary = max(variants, key=lambda t: _richness(t.spec or {}, t.logo, t.description))
    cats: list[str] = []
    sources: list[str] = []
    for t in variants:
        for c in t.categories or []:
            if c not in cats:
                cats.append(c)
        if t.source not in sources:
            sources.append(t.source)
    # Description and logo come from whichever variant has the richest one,
    # independent of which variant is "primary" for spec richness.
    description = max((t.description or "" for t in variants), key=len)
    logo = primary.logo or next((t.logo for t in variants if t.logo), "")
    return {
        "app_group": primary.app_group or primary.id,
        "name": primary.name,
        "description": description,
        "logo": logo,
        "categories": cats,
        "kind": primary.kind,
        "primary_id": primary.id,
        "sources": sources,
        "variant_count": len(variants),
        "variants": [
            {"id": t.id, "image": t.image, "image_key": t.image_key, "source": t.source} for t in variants
        ],
    }


def list_templates(search: str = "", category: str = "", source: str = "", limit: int = 60, offset: int = 0) -> dict[str, Any]:
    with session_scope() as db:
        rows = db.exec(select(CatalogTemplate)).all()
    groups: dict[str, list[CatalogTemplate]] = {}
    for t in rows:
        groups.setdefault(t.app_group or t.id, []).append(t)
    apps = [_app_from_variants(v) for v in groups.values()]

    if search:
        s = search.lower()
        apps = [a for a in apps if s in a["name"].lower() or s in a["description"].lower()]
    if category:
        apps = [a for a in apps if category in (a["categories"] or [])]
    if source:
        apps = [a for a in apps if source in a["sources"]]
    apps.sort(key=lambda a: a["name"].lower())
    total = len(apps)
    return {"total": total, "items": apps[offset : offset + limit]}


def get_template(template_id: str) -> dict[str, Any] | None:
    with session_scope() as db:
        t = db.get(CatalogTemplate, template_id)
        return _to_dict(t) if t else None


def categories() -> list[dict[str, Any]]:
    with session_scope() as db:
        rows = db.exec(select(CatalogTemplate)).all()
    # Count distinct apps (app_group), not raw variants.
    seen: dict[str, set] = {}
    for t in rows:
        for c in t.categories or []:
            seen.setdefault(c, set()).add(t.app_group or t.id)
    return sorted(({"name": k, "count": len(v)} for k, v in seen.items()), key=lambda c: c["name"].lower())


def status() -> dict[str, Any]:
    with session_scope() as db:
        rows = db.exec(select(CatalogTemplate)).all()
    last = max((t.updated_at for t in rows), default=None)
    by_source: dict[str, int] = {}
    apps: set = set()
    for t in rows:
        by_source[t.source] = by_source.get(t.source, 0) + 1
        apps.add(t.app_group or t.id)
    return {
        "total": len(apps),
        "variants": len(rows),
        "last_synced": last.isoformat() if last else None,
        "by_source": by_source,
    }
