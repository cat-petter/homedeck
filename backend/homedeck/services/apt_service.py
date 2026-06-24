"""APT app store — read-only browse over python-apt.

Phase 6 (browse half). Exposes a searchable, app-focused view of the host's APT
universe plus the set of installed packages, using python-apt as the source of
truth (AppStream's catalog pool is typically empty on a minimal Debian, so we
don't depend on it; it can enrich icons/names later if populated).

Mutations (install/remove/upgrade) live in a separate, privileged path behind
the scoped sudoers helper and the app-level install password — not here.
"""

from __future__ import annotations

import re
import subprocess
import threading
from typing import Any

import apt

from ..config import get_settings

# Debian sections that contain end-user apps/tools (vs libraries, language
# bindings, docs, debug symbols). The huge majority of the 63k packages are not
# app-store material; this keeps browse useful. Section may be "area/section"
# (e.g. "non-free/utils") — we match the trailing component.
_APP_SECTIONS = {
    "admin", "comm", "database", "editors", "education", "electronics", "embedded",
    "games", "gnome", "graphics", "hamradio", "httpd", "kde", "mail", "math",
    "misc", "net", "news", "science", "shells", "sound", "text", "utils", "vcs",
    "video", "web", "x11", "otherosfs", "xfce", "cli-mono", "interpreters",
}

# Name patterns that are almost never a user-facing app.
_EXCLUDE_PREFIXES = ("lib", "fonts-", "python-", "python3-", "golang-", "node-",
                     "ruby-", "rust-", "haskell-", "ghc-", "php-", "r-cran-", "r-bioc-")
_EXCLUDE_SUFFIXES = ("-dev", "-dbg", "-dbgsym", "-doc", "-common", "-data",
                     "-perl", "-dev-bin", "-dovecot")

_lock = threading.Lock()
_cache: apt.Cache | None = None
_index: list[dict[str, Any]] | None = None
_last_error: str | None = None


class AptUnavailable(RuntimeError):
    """The APT cache couldn't be read right now (e.g. a package op is in progress)."""


def _section_leaf(section: str) -> str:
    return (section or "").rsplit("/", 1)[-1]


def _is_app_like(name: str, section: str) -> bool:
    if name.startswith(_EXCLUDE_PREFIXES):
        return False
    if name.endswith(_EXCLUDE_SUFFIXES):
        return False
    return _section_leaf(section) in _APP_SECTIONS


def _get_cache() -> apt.Cache:
    global _cache
    if _cache is None:
        try:
            _cache = apt.Cache()
        except Exception as exc:  # noqa: BLE001 - cache can be mid-rewrite during an apt op
            raise AptUnavailable(str(exc)) from exc
    return _cache


def _summarize(pkg: apt.package.Package) -> dict[str, Any] | None:
    cand = pkg.candidate or pkg.installed
    if cand is None:
        return None
    return {
        "name": pkg.name,
        "summary": cand.summary or "",
        "section": _section_leaf(cand.section or ""),
        "installed": pkg.is_installed,
        "upgradable": pkg.is_upgradable,
        "installed_version": pkg.installed.version if pkg.installed else None,
        "candidate_version": cand.version,
    }


def _build_index() -> list[dict[str, Any]]:
    cache = _get_cache()
    out: list[dict[str, Any]] = []
    for pkg in cache:
        cand = pkg.candidate or pkg.installed
        if cand is None:
            continue
        # Keep every installed package (so the user can manage anything) plus
        # app-like available ones.
        if not pkg.is_installed and not _is_app_like(pkg.name, cand.section or ""):
            continue
        s = _summarize(pkg)
        if s:
            out.append(s)
    out.sort(key=lambda p: p["name"])
    return out


def _get_index() -> list[dict[str, Any]]:
    global _index, _last_error
    if _index is None:
        try:
            _index = _build_index()
        except AptUnavailable as exc:
            _last_error = str(exc)
            raise
        _last_error = None
    return _index


def refresh() -> None:
    """Drop cached cache+index so the next read reflects on-disk state.

    Call after an install/remove/upgrade (or `apt update`).
    """
    global _cache, _index
    with _lock:
        if _cache is not None:
            try:
                _cache.close()
            except Exception:  # noqa: BLE001
                pass
        _cache = None
        _index = None


# --- Public read API --------------------------------------------------------

def status() -> dict[str, Any]:
    with _lock:
        try:
            idx = _get_index()
        except AptUnavailable:
            return {"total": 0, "installed": 0, "upgradable": 0, "available": False, "error": _last_error}
        installed = sum(1 for p in idx if p["installed"])
        upgradable = sum(1 for p in idx if p["upgradable"])
        return {"total": len(idx), "installed": installed, "upgradable": upgradable, "available": True, "error": None}


def search(query: str = "", installed_only: bool = False, upgradable_only: bool = False,
           limit: int = 60, offset: int = 0) -> dict[str, Any]:
    q = (query or "").strip().lower()
    with _lock:
        try:
            idx = _get_index()
        except AptUnavailable:
            return {"total": 0, "items": [], "available": False, "error": _last_error}
        items = idx
        if installed_only:
            items = [p for p in items if p["installed"]]
        if upgradable_only:
            items = [p for p in items if p["upgradable"]]
        if q:
            items = [p for p in items if q in p["name"].lower() or q in p["summary"].lower()]
            # Exact/prefix name matches first, then the rest alphabetically.
            items = sorted(items, key=lambda p: (p["name"].lower() != q, not p["name"].lower().startswith(q), p["name"]))
        total = len(items)
        return {"total": total, "items": items[offset : offset + limit], "available": True, "error": None}


def package_detail(name: str) -> dict[str, Any] | None:
    with _lock:
        cache = _get_cache()
        if name not in cache:
            return None
        pkg = cache[name]
        cand = pkg.candidate or pkg.installed
        if cand is None:
            return None
        return {
            "name": pkg.name,
            "summary": cand.summary or "",
            "description": cand.description or "",
            "section": _section_leaf(cand.section or ""),
            "homepage": getattr(cand, "homepage", "") or "",
            "installed": pkg.is_installed,
            "upgradable": pkg.is_upgradable,
            "installed_version": pkg.installed.version if pkg.installed else None,
            "candidate_version": cand.version,
            "installed_size": cand.installed_size,
            "download_size": cand.size,
            "priority": cand.priority or "",
            "origin": (cand.origins[0].label if cand.origins else "") or "",
        }


# --- Privileged operations (via the scoped sudo helper) ---------------------

_VERBS = {"update", "install", "remove", "upgrade", "upgrade-all"}
_NO_PKG_VERBS = {"update", "upgrade-all"}
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9+._-]*$")


class AptCommandError(ValueError):
    """The requested verb/packages are invalid (rejected before running)."""


def validate(verb: str, packages: list[str]) -> None:
    if verb not in _VERBS:
        raise AptCommandError(f"Unknown action: {verb!r}")
    if verb in _NO_PKG_VERBS:
        if packages:
            raise AptCommandError(f"{verb} takes no packages")
        return
    if not packages:
        raise AptCommandError(f"{verb} requires at least one package")
    for p in packages:
        if not _NAME_RE.match(p):
            raise AptCommandError(f"Invalid package name: {p!r}")


def build_command(verb: str, packages: list[str]) -> list[str]:
    """Validate, then return the argv for `sudo homedeck-apt <verb> [pkgs]`."""
    validate(verb, packages)
    cfg = get_settings().apt
    return [cfg.sudo_path, "-n", cfg.helper_path, verb, *packages]


def popen(verb: str, packages: list[str]) -> subprocess.Popen:
    """Start the privileged helper, streaming combined stdout/stderr (text)."""
    cmd = build_command(verb, packages)
    return subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        bufsize=1,
        text=True,
    )
