"""Discover web UIs of existing containers and propose quick-launch tiles.

Signal hierarchy:
  1. Dashboard labels (homepage.*) — an explicit URL/name/icon/group.
  2. Published TCP ports + an active HTTP(S) probe — confirms which port actually
     serves a web UI (so databases / VPN sidecars are filtered out).
  3. Image → app metadata (name, default web port, icon) as the tiebreaker/labels.

Everything is *proposed*; the user confirms each before a tile is created.
"""

from __future__ import annotations

import asyncio
import ssl
import urllib.error
import urllib.request
from typing import Any

from docker.errors import DockerException
from sqlmodel import select

from ..db import session_scope
from ..models import Service
from .app_metadata import app_metadata
from .docker_service import DockerUnavailable, _image_name, get_client
from .net import get_connectivity

HTTPS_LIKELY = {443, 8443, 9443}
PROBE_TIMEOUT = 1.8


def _published_tcp_ports(container: Any) -> list[int]:
    ports = (container.attrs.get("NetworkSettings") or {}).get("Ports") or {}
    host_ports: set[int] = set()
    for key, bindings in ports.items():
        _, _, proto = key.partition("/")
        if (proto or "tcp") != "tcp" or not bindings:
            continue
        for b in bindings:
            hp = b.get("HostPort")
            if hp and hp.isdigit():
                host_ports.add(int(hp))
    return sorted(host_ports)


def _probe(port: int, prefer_https: bool) -> tuple[bool, str | None, int | None]:
    """Probe 127.0.0.1:port over HTTP/HTTPS. Any HTTP response = a web server."""
    schemes = ("https", "http") if prefer_https else ("http", "https")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    for scheme in schemes:
        url = f"{scheme}://127.0.0.1:{port}/"
        try:
            req = urllib.request.Request(url, method="GET", headers={"User-Agent": "HomeDeck-discover/1.0"})
            with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT, context=ctx) as r:
                return (True, scheme, r.status)
        except urllib.error.HTTPError as exc:
            return (True, scheme, exc.code)  # server responded (401/403/500…)
        except Exception:  # noqa: BLE001 - wrong scheme / not a web port
            continue
    return (False, None, None)


def _resolve_icon(labels: dict[str, str], meta_icon: str) -> str:
    hp_icon = labels.get("homepage.icon", "")
    if hp_icon.startswith("http://") or hp_icon.startswith("https://"):
        return hp_icon
    return meta_icon


def _is_added(existing: str, *needles: str) -> bool:
    return any(n and n.lower() in existing for n in needles)


async def _analyze(container: Any, lan_ip: str, existing: str) -> dict[str, Any] | None:
    attrs = container.attrs
    labels = (attrs.get("Config") or {}).get("Labels") or {}
    image = _image_name(container)
    meta = app_metadata(image)

    name = labels.get("homepage.name") or meta.name or container.name
    category = labels.get("homepage.group", "")
    icon = _resolve_icon(labels, meta.icon_url)

    base = {
        "container_id": container.id,
        "container_name": container.name,
        "image": image,
        "name": name,
        "category": category,
        "icon_url": icon,
    }

    # 1) Explicit homepage label.
    href = labels.get("homepage.href")
    if href:
        return {**base, "url": href, "port": None, "scheme": None, "source": "label", "already_added": _is_added(existing, href)}

    # 2) Probe published ports (web_port first, then the rest).
    ports = _published_tcp_ports(container)
    if not ports:
        return None
    ordered = sorted(ports, key=lambda p: p != meta.web_port)
    results = await asyncio.gather(*(asyncio.to_thread(_probe, p, p in HTTPS_LIKELY) for p in ordered))
    for port, (ok, scheme, status) in zip(ordered, results):
        if ok:
            url = f"{scheme}://{lan_ip}:{port}"
            return {
                **base,
                "url": url,
                "port": port,
                "scheme": scheme,
                "http_status": status,
                "source": "probe",
                "already_added": _is_added(existing, f"{lan_ip}:{port}", f":{port}"),
            }
    return None


async def discover() -> list[dict[str, Any]]:
    client = get_client()
    try:
        containers = await asyncio.to_thread(lambda: client.containers.list(all=False))
    except DockerException as exc:
        raise DockerUnavailable(str(exc)) from exc

    lan_ip = get_connectivity().lan_ip or "127.0.0.1"
    with session_scope() as db:
        services = db.exec(select(Service)).all()
        existing = " ".join(f"{s.lan_url} {s.tailscale_url}" for s in services).lower()

    results = await asyncio.gather(*(_analyze(c, lan_ip, existing) for c in containers))
    suggestions = [r for r in results if r]
    suggestions.sort(key=lambda s: (s["already_added"], s["name"].lower()))
    return suggestions
