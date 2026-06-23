"""Render a docker-compose spec from a user's install config, and validate it.

Used by the pre-install config form: the form posts a config (ports/env/volumes/
network/restart), and this renders the compose YAML for preview/raw-edit and
flags problems (host-port conflicts, duplicate ports, missing required env).
The actual deploy lands in the next step.
"""

from __future__ import annotations

import re
from typing import Any

import psutil
import yaml

from .docker_service import DockerUnavailable, get_client

_NAME_RE = re.compile(r"[^a-z0-9_.-]+")


def safe_name(name: str) -> str:
    n = _NAME_RE.sub("-", (name or "").lower()).strip("-_.")
    return n or "app"


# --- Used host ports (for conflict detection) -------------------------------

def used_host_ports() -> set[int]:
    """Host TCP/UDP ports already taken — by Docker publishes and by listeners."""
    ports: set[int] = set()
    # Listening sockets on the host.
    try:
        for c in psutil.net_connections(kind="inet"):
            if c.status == psutil.CONN_LISTEN and c.laddr:
                ports.add(c.laddr.port)
    except (psutil.AccessDenied, PermissionError):
        pass
    # Docker published host ports (covers containers whose ports we may not see
    # as listeners, e.g. via proxy processes).
    try:
        for cont in get_client().containers.list(all=False):
            for _key, bindings in ((cont.attrs.get("NetworkSettings") or {}).get("Ports") or {}).items():
                for b in bindings or []:
                    hp = b.get("HostPort")
                    if hp and hp.isdigit():
                        ports.add(int(hp))
    except DockerUnavailable:
        pass
    except Exception:  # noqa: BLE001 - best-effort
        pass
    return ports


# --- Render -----------------------------------------------------------------

def render_compose(image: str, config: dict[str, Any]) -> dict[str, Any]:
    """Build a compose dict from a config. Single-service (the template image)."""
    name = safe_name(config.get("name") or "")
    service: dict[str, Any] = {"image": image, "container_name": name}

    restart = config.get("restart_policy") or "unless-stopped"
    service["restart"] = restart

    ports: list[str] = []
    for p in config.get("ports") or []:
        host = str(p.get("host_port") or "").strip()
        cont = str(p.get("container_port") or "").strip()
        proto = p.get("protocol") or "tcp"
        if not cont or not host:
            continue  # unpublished ports are omitted
        ports.append(f"{host}:{cont}/{proto}" if proto != "tcp" else f"{host}:{cont}")
    if ports:
        service["ports"] = ports

    env = {e["name"]: str(e.get("value", "")) for e in (config.get("env") or []) if e.get("name")}
    if env:
        service["environment"] = env

    volumes: list[str] = []
    for v in config.get("volumes") or []:
        cont = str(v.get("container_path") or "").strip()
        src = str(v.get("source") or "").strip()
        if not cont or not src:
            continue
        ro = ":ro" if v.get("readonly") else ""
        volumes.append(f"{src}:{cont}{ro}")
    if volumes:
        service["volumes"] = volumes

    network = (config.get("network") or "").strip()
    compose: dict[str, Any] = {"services": {name: service}}
    if network in ("host", "none"):
        service["network_mode"] = network
    elif network and network != "bridge":
        service["networks"] = [network]
        compose["networks"] = {network: {"external": True}}

    # Named volumes (source has no path separator) get declared at top level.
    named = {
        v.split(":", 1)[0]
        for v in volumes
        if "/" not in v.split(":", 1)[0]
    }
    if named:
        compose["volumes"] = {n: {} for n in named}

    return compose


def to_yaml(compose: dict[str, Any]) -> str:
    return yaml.safe_dump(compose, sort_keys=False, default_flow_style=False)


# --- Validate ---------------------------------------------------------------

def validate(config: dict[str, Any], required_env: list[str] | None = None) -> dict[str, Any]:
    issues: list[dict[str, str]] = []

    # Host-port conflicts + duplicates within the config.
    used = used_host_ports()
    seen: dict[int, str] = {}
    for p in config.get("ports") or []:
        hp = str(p.get("host_port") or "").strip()
        if not hp or not hp.isdigit():
            continue
        port = int(hp)
        if port in seen:
            issues.append({"level": "error", "field": f"port:{hp}", "message": f"Host port {hp} is used twice in this config."})
        seen[port] = hp
        if port in used:
            issues.append({"level": "error", "field": f"port:{hp}", "message": f"Host port {hp} is already in use on this host."})

    # Missing required env.
    values = {e["name"]: str(e.get("value", "")) for e in (config.get("env") or [])}
    for name in required_env or []:
        if not values.get(name):
            issues.append({"level": "error", "field": f"env:{name}", "message": f"Required variable {name} is empty."})

    ok = not any(i["level"] == "error" for i in issues)
    return {"ok": ok, "issues": issues}
