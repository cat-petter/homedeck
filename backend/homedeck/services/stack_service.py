"""Fetch the compose file for a multi-service ("stack") catalog template.

Portainer stack templates point at a git repo + stackfile rather than a single
image. We fetch that compose so the user can review/edit it before deploying it
verbatim with `docker compose up -d`. Many such stacks are Swarm-oriented
(overlay networks, `deploy:`), which may need edits to run under compose — we
flag that rather than silently failing.
"""

from __future__ import annotations

import re
import urllib.error
import urllib.request
from typing import Any

from ..config import get_settings
from . import catalog_service as csvc

_UA = "HomeDeck-stack/1.0"
_GITHUB_RE = re.compile(r"^https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$", re.I)
_BRANCHES = ("main", "master")
# Tokens that suggest a Swarm stack (won't necessarily run under plain compose).
_SWARM_HINTS = ("driver: overlay", "deploy:", "mode: global", "mode: replicated", "placement:")


class StackError(RuntimeError):
    pass


def _fetch(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=get_settings().catalog.fetch_timeout_seconds) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, ""
    except urllib.error.URLError as exc:
        raise StackError(f"Could not reach {url}: {exc.reason}") from exc


def _fetch_github_stackfile(repo_url: str, stackfile: str) -> str:
    m = _GITHUB_RE.match(repo_url.strip())
    if not m:
        raise StackError(f"Unsupported stack repository (only github.com is supported): {repo_url}")
    owner, repo = m.group(1), m.group(2)
    path = stackfile.lstrip("/")
    last_code = None
    for branch in _BRANCHES:
        url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
        code, body = _fetch(url)
        if code == 200 and body.strip():
            return body
        last_code = code
    raise StackError(f"Could not fetch stackfile from {repo_url} ({stackfile}); last status {last_code}.")


def get_compose(template_id: str) -> dict[str, Any]:
    t = csvc.get_template(template_id)
    if t is None:
        raise StackError("Template not found.")
    spec = t.get("spec") or {}
    repo = spec.get("repository") or {}
    url, stackfile = (repo.get("url") or "").strip(), (repo.get("stackfile") or "").strip()
    if not url or not stackfile:
        raise StackError("This template has no stackfile to fetch.")
    compose_yaml = _fetch_github_stackfile(url, stackfile)
    swarmish = any(h in compose_yaml for h in _SWARM_HINTS)
    return {
        "compose_yaml": compose_yaml,
        "source_url": f"{url} · {stackfile}",
        "swarmish": swarmish,
    }
