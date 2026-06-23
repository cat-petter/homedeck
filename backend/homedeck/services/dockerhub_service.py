"""Docker Hub fallback: live image search + repo/tag/README inspection.

For apps not in the imported catalog (or any image the user wants), this queries
Docker Hub's public v2 API directly. It also powers a freshness signal: catalog
entries can be checked against the registry so renamed/abandoned images (e.g.
``hacdias/filemanager``, which 404s) surface as deprecated instead of failing
silently at deploy time.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from ..config import REPO_ROOT, get_settings
from .app_metadata import app_metadata, parse_image

_HUB = "https://hub.docker.com/v2"
_UA = "HomeDeck-hub/1.0"
# README/full description can be large; cap what we ship to the UI.
_README_MAX = 8000
# Images not pushed in this long are flagged as likely stale.
_STALE_DAYS = 730
_RENAMES_FILE = REPO_ROOT / "catalog" / "overrides" / "image-renames.json"


class HubError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _curated_renames() -> dict[str, str]:
    """Hand-verified old-repo -> new-repo remaps from catalog/overrides."""
    try:
        data = json.loads(_RENAMES_FILE.read_text(encoding="utf-8"))
        return {k.lower(): v for k, v in (data.get("renames") or {}).items()}
    except (OSError, ValueError):
        return {}


def _timeout() -> int:
    return get_settings().catalog.fetch_timeout_seconds


def _get_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=_timeout()) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise HubError(f"Docker Hub returned {exc.code} for {url}") from exc
    except urllib.error.URLError as exc:
        raise HubError(f"Could not reach Docker Hub: {exc.reason}") from exc


def _api_repo(repo: str) -> str:
    """Normalize a user-facing repo (``nginx``, ``linuxserver/jellyfin``) to the
    Hub API path namespace/name (official → ``library/nginx``)."""
    parsed = parse_image(repo)
    if parsed["registry"] != "docker.io":
        raise HubError(f"{repo} is not a Docker Hub image (registry {parsed['registry']}).")
    return parsed["repository"]


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


# --- Search -----------------------------------------------------------------

def search(query: str, limit: int = 25) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        return {"results": []}
    q = urllib.parse.urlencode({"query": query, "page_size": max(1, min(limit, 100))})
    data = _get_json(f"{_HUB}/search/repositories/?{q}")
    results = []
    for r in data.get("results", []):
        repo = r.get("repo_name", "")
        meta = app_metadata(repo)
        results.append(
            {
                "repo": repo,
                "description": r.get("short_description", ""),
                "stars": r.get("star_count", 0),
                "pulls": r.get("pull_count"),
                "is_official": bool(r.get("is_official")),
                "is_automated": bool(r.get("is_automated")),
                "icon": meta.icon_url,
            }
        )
    return {"count": data.get("count", len(results)), "results": results}


# --- Tags -------------------------------------------------------------------

def get_tags(repo: str, limit: int = 25) -> list[dict[str, Any]]:
    api = _api_repo(repo)
    q = urllib.parse.urlencode({"page_size": max(1, min(limit, 100)), "ordering": "last_updated"})
    data = _get_json(f"{_HUB}/repositories/{api}/tags/?{q}")
    out = []
    for t in data.get("results", []):
        arches = sorted({i.get("architecture") for i in (t.get("images") or []) if i.get("architecture")})
        out.append(
            {
                "name": t.get("name"),
                "last_updated": t.get("last_updated"),
                "size": t.get("full_size"),
                "architectures": arches,
            }
        )
    return out


# --- Inspect ----------------------------------------------------------------

def inspect(repo: str) -> dict[str, Any]:
    api = _api_repo(repo)
    data = _get_json(f"{_HUB}/repositories/{api}/")
    full = data.get("full_description") or ""
    truncated = len(full) > _README_MAX
    meta = app_metadata(repo)
    try:
        tags = get_tags(repo, limit=25)
    except HubError:
        tags = []
    return {
        "repo": repo,
        "namespace": data.get("namespace", ""),
        "name": data.get("name", ""),
        "description": data.get("description", ""),
        "readme": full[:_README_MAX],
        "readme_truncated": truncated,
        "stars": data.get("star_count", 0),
        "pulls": data.get("pull_count"),
        "is_official": data.get("namespace") == "library",
        "last_updated": data.get("last_updated"),
        "tags": tags,
        # Seed for the install form: derived name/icon/likely web port.
        "suggested": {"title": meta.name, "icon": meta.icon_url, "web_port": meta.web_port},
    }


# --- Replacement resolution (for renamed/removed images) --------------------

def _repo_exists(repo: str) -> bool:
    try:
        _get_json(f"{_HUB}/repositories/{repo}/")
        return True
    except HubError:
        return False


def find_replacement(image_ref: str) -> dict[str, Any] | None:
    """Suggest a current image for one that 404s on Docker Hub.

    Order: hand-verified curated remap, then a best-effort Hub name search.
    Always returned with a ``source``/``reason`` so the UI can disclaim it.
    """
    parsed = parse_image(image_ref)
    if parsed["registry"] != "docker.io":
        return None
    original = parsed["repository"]

    curated = _curated_renames().get(original.lower())
    if curated and _repo_exists(curated):
        return {"repo": curated, "source": "curated", "reason": "Hand-verified rename."}

    # Heuristic: search Hub by the app slug and take the most relevant existing
    # repo that isn't the (now-gone) original. Low confidence — hence disclaimed.
    slug = parsed["slug"]
    try:
        results = search(slug, limit=5).get("results", [])
    except HubError:
        results = []
    for r in results:
        cand = parse_image(r["repo"])["repository"]
        if cand.lower() != original.lower():
            return {
                "repo": r["repo"],
                "source": "search",
                "reason": f"Closest Docker Hub match for “{slug}”.",
            }
    return None


# --- Freshness signal (for catalog entries) ---------------------------------

def image_status(image_ref: str) -> dict[str, Any]:
    """Lightweight existence/freshness check for a catalog image on Docker Hub.

    Returns ``checked: False`` for non-Hub registries (we can't speak to those).
    When an image is gone, attaches a ``replacement`` suggestion if one is found.
    """
    parsed = parse_image(image_ref)
    if parsed["registry"] != "docker.io":
        return {"checked": False, "registry": parsed["registry"]}
    api = parsed["repository"]
    try:
        data = _get_json(f"{_HUB}/repositories/{api}/")
    except HubError as exc:
        msg = str(exc)
        if "404" in msg:
            return {
                "checked": True,
                "exists": False,
                "stale": False,
                "message": "Image not found on Docker Hub — likely renamed or removed.",
                "replacement": find_replacement(image_ref),
            }
        return {"checked": False, "error": msg}
    last = _parse_dt(data.get("last_updated"))
    stale = False
    if last is not None:
        age_days = (datetime.now(timezone.utc) - last).days
        stale = age_days > _STALE_DAYS
    return {
        "checked": True,
        "exists": True,
        "stale": stale,
        "last_updated": data.get("last_updated"),
        "message": ("Not updated in over 2 years on Docker Hub." if stale else ""),
    }
