"""Docker integration via the Docker SDK for Python.

All functions here are blocking (the SDK uses requests under the hood). Sync
FastAPI route handlers run them in Starlette's threadpool automatically; async
WebSocket handlers must call them via ``asyncio.to_thread``.

Real Docker/daemon errors are surfaced verbatim through ``DockerUnavailable`` and
the SDK's ``APIError``/``NotFound`` (the router maps these to HTTP responses).
"""

from __future__ import annotations

from typing import Any

import docker
from docker.errors import DockerException
from docker.models.containers import Container

from ..config import get_settings

_settings = get_settings()
_client: docker.DockerClient | None = None

# The status WebSocket reads container stats concurrently (see
# routers/docker.MAX_STATS_CONCURRENCY = 16). docker-py's HTTP pool defaults to
# 10, so without this several concurrent reads would block waiting for a socket.
# Size it above the stats concurrency, with headroom for other in-flight calls.
_POOL_SIZE = 24


class DockerUnavailable(RuntimeError):
    """The Docker daemon could not be reached."""


def get_client() -> docker.DockerClient:
    """Return a lazily-created, reused Docker client bound to the configured socket."""
    global _client
    if _client is None:
        try:
            _client = docker.DockerClient(base_url=_settings.docker.socket, max_pool_size=_POOL_SIZE)
        except DockerException as exc:  # pragma: no cover - depends on host
            raise DockerUnavailable(str(exc)) from exc
    return _client


def ping() -> bool:
    try:
        return bool(get_client().ping())
    except DockerException as exc:
        raise DockerUnavailable(str(exc)) from exc


def network_options() -> list[dict[str, str]]:
    """Network choices for the install form: built-ins, user networks, and
    running containers (to share a container's netns, e.g. route via gluetun)."""
    options: list[dict[str, str]] = [
        {"value": "bridge", "label": "bridge (default)"},
        {"value": "host", "label": "host"},
        {"value": "none", "label": "none"},
    ]
    builtin = {"bridge", "host", "none"}
    try:
        client = get_client()
        for n in client.networks.list():
            if n.name and n.name not in builtin:
                driver = (n.attrs or {}).get("Driver", "")
                options.append({"value": n.name, "label": f"{n.name} ({driver or 'network'})"})
        for c in client.containers.list():
            options.append({"value": f"container:{c.name}", "label": f"{c.name} (share container network)"})
    except DockerException as exc:
        raise DockerUnavailable(str(exc)) from exc
    return options


# --- Serialization helpers --------------------------------------------------

def _format_ports(container: Container) -> list[dict[str, Any]]:
    """Normalize NetworkSettings.Ports into a flat list.

    Shape: {container_port, protocol, host_ip, host_port}. Unpublished ports are
    included with host_ip/host_port = None.
    """
    raw = (container.attrs.get("NetworkSettings") or {}).get("Ports") or {}
    out: list[dict[str, Any]] = []
    # Docker lists a separate binding per host IP (0.0.0.0 and ::), which would
    # show the same published port twice. Dedupe on (cport, proto, host_port),
    # preferring the IPv4 binding for the displayed host_ip.
    seen: dict[tuple[str, str, str | None], dict[str, Any]] = {}
    for key, bindings in raw.items():
        cport, _, proto = key.partition("/")
        proto = proto or "tcp"
        if bindings:
            for b in bindings:
                host_ip = b.get("HostIp") or None
                host_port = b.get("HostPort") or None
                dedupe_key = (cport, proto, host_port)
                existing = seen.get(dedupe_key)
                if existing is None:
                    entry = {
                        "container_port": cport,
                        "protocol": proto,
                        "host_ip": host_ip,
                        "host_port": host_port,
                    }
                    seen[dedupe_key] = entry
                    out.append(entry)
                elif host_ip == "0.0.0.0" and existing["host_ip"] != "0.0.0.0":
                    existing["host_ip"] = host_ip
        else:
            dedupe_key = (cport, proto, None)
            if dedupe_key not in seen:
                entry = {"container_port": cport, "protocol": proto, "host_ip": None, "host_port": None}
                seen[dedupe_key] = entry
                out.append(entry)
    return out


def _image_name(container: Container) -> str:
    tags = container.image.tags if container.image else []
    if tags:
        return tags[0]
    # Fall back to the image reference recorded on the container config.
    cfg_image = (container.attrs.get("Config") or {}).get("Image")
    if cfg_image:
        return cfg_image
    image_id = container.attrs.get("Image", "")
    return image_id[:19] if image_id else "<none>"


def summarize(container: Container) -> dict[str, Any]:
    """A list-friendly summary (no live stats — those come via the stats stream)."""
    state = container.attrs.get("State") or {}
    return {
        "id": container.id,
        "short_id": container.short_id,
        "name": container.name,
        "image": _image_name(container),
        "state": container.status,  # running|exited|paused|created|restarting|dead
        "status": state.get("Status", container.status),
        "status_text": container.attrs.get("Status") or "",
        "created": container.attrs.get("Created"),
        "started_at": state.get("StartedAt"),
        "finished_at": state.get("FinishedAt"),
        "ports": _format_ports(container),
        "labels": (container.attrs.get("Config") or {}).get("Labels") or {},
        "restart_policy": (
            (container.attrs.get("HostConfig") or {}).get("RestartPolicy") or {}
        ).get("Name")
        or "",
    }


def list_containers(all_: bool = True) -> list[dict[str, Any]]:
    try:
        containers = get_client().containers.list(all=all_)
    except DockerException as exc:
        raise DockerUnavailable(str(exc)) from exc
    summaries = [summarize(c) for c in containers]
    summaries.sort(key=lambda c: (c["state"] != "running", c["name"].lower()))
    return summaries


def get_container(container_id: str) -> Container:
    try:
        return get_client().containers.get(container_id)
    except DockerException as exc:
        # NotFound is a DockerException subclass; let the router translate it.
        raise exc if not _is_conn_error(exc) else DockerUnavailable(str(exc))


def _is_conn_error(exc: Exception) -> bool:
    from docker.errors import APIError, NotFound

    return not isinstance(exc, (APIError, NotFound))


# --- Live stats -------------------------------------------------------------

def _calc_cpu_percent(stats: dict[str, Any]) -> float | None:
    cpu = stats.get("cpu_stats") or {}
    precpu = stats.get("precpu_stats") or {}
    try:
        cpu_total = cpu["cpu_usage"]["total_usage"]
        pre_total = precpu["cpu_usage"]["total_usage"]
        system = cpu.get("system_cpu_usage")
        pre_system = precpu.get("system_cpu_usage")
    except (KeyError, TypeError):
        return None
    if system is None or pre_system is None:
        return None
    cpu_delta = cpu_total - pre_total
    system_delta = system - pre_system
    if system_delta <= 0 or cpu_delta < 0:
        return 0.0
    online = cpu.get("online_cpus")
    if not online:
        percpu = (cpu.get("cpu_usage") or {}).get("percpu_usage") or []
        online = len(percpu) or 1
    return round((cpu_delta / system_delta) * online * 100.0, 2)


def _calc_memory(stats: dict[str, Any]) -> tuple[int | None, int | None, float | None]:
    mem = stats.get("memory_stats") or {}
    usage = mem.get("usage")
    limit = mem.get("limit")
    if usage is None:
        return None, None, None
    # cgroup v2 (Debian 12 default): subtract inactive_file for "real" usage.
    inactive = (mem.get("stats") or {}).get("inactive_file", 0)
    used = max(usage - inactive, 0)
    pct = round((used / limit) * 100.0, 2) if limit else None
    return used, limit, pct


def _calc_net(stats: dict[str, Any]) -> tuple[int, int]:
    networks = stats.get("networks") or {}
    rx = sum(n.get("rx_bytes", 0) for n in networks.values())
    tx = sum(n.get("tx_bytes", 0) for n in networks.values())
    return rx, tx


def stats_snapshot(container: Container) -> dict[str, Any]:
    """One non-streaming stats read, reduced to the fields the UI shows."""
    raw = container.stats(stream=False)
    used, limit, mem_pct = _calc_memory(raw)
    rx, tx = _calc_net(raw)
    return {
        "id": container.id,
        "cpu_pct": _calc_cpu_percent(raw),
        "mem_used": used,
        "mem_limit": limit,
        "mem_pct": mem_pct,
        "net_rx": rx,
        "net_tx": tx,
    }


# --- Actions ----------------------------------------------------------------

def start(container_id: str) -> None:
    get_container(container_id).start()


def stop(container_id: str) -> None:
    get_container(container_id).stop()


def restart(container_id: str) -> None:
    get_container(container_id).restart()


def pause(container_id: str) -> None:
    get_container(container_id).pause()


def unpause(container_id: str) -> None:
    get_container(container_id).unpause()


def remove(container_id: str, *, force: bool = False, remove_volumes: bool = False) -> None:
    get_container(container_id).remove(force=force, v=remove_volumes)


# --- Inspect ----------------------------------------------------------------

def _parse_env(env_list: list[str] | None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in env_list or []:
        key, _, value = item.partition("=")
        out.append({"key": key, "value": value})
    return out


def inspect(container_id: str) -> dict[str, Any]:
    container = get_container(container_id)
    attrs = container.attrs
    config = attrs.get("Config") or {}
    networks = (attrs.get("NetworkSettings") or {}).get("Networks") or {}
    mounts = attrs.get("Mounts") or []
    return {
        "id": container.id,
        "name": container.name,
        "image": _image_name(container),
        "command": config.get("Cmd"),
        "entrypoint": config.get("Entrypoint"),
        "working_dir": config.get("WorkingDir") or "",
        "env": _parse_env(config.get("Env")),
        "labels": config.get("Labels") or {},
        "mounts": [
            {
                "type": m.get("Type"),
                "source": m.get("Source"),
                "destination": m.get("Destination"),
                "mode": m.get("Mode"),
                "rw": m.get("RW"),
                "name": m.get("Name"),
            }
            for m in mounts
        ],
        "networks": [
            {
                "name": name,
                "ip_address": n.get("IPAddress") or None,
                "gateway": n.get("Gateway") or None,
                "mac_address": n.get("MacAddress") or None,
                "aliases": n.get("Aliases") or [],
            }
            for name, n in networks.items()
        ],
        "ports": _format_ports(container),
        "restart_policy": (attrs.get("HostConfig") or {}).get("RestartPolicy") or {},
        "state": attrs.get("State") or {},
    }


# --- Logs -------------------------------------------------------------------

def recent_logs(container_id: str, tail: int = 200, timestamps: bool = False) -> str:
    container = get_container(container_id)
    data = container.logs(tail=tail, timestamps=timestamps, stdout=True, stderr=True)
    return data.decode("utf-8", errors="replace")


def log_stream(container_id: str, tail: int = 200, timestamps: bool = False):
    """Return a blocking line iterator that follows the container's logs."""
    container = get_container(container_id)
    return container.logs(
        stream=True,
        follow=True,
        tail=tail,
        timestamps=timestamps,
        stdout=True,
        stderr=True,
    )


# --- Interactive exec (web terminal) ----------------------------------------

def exec_create_shell(container_id: str) -> str:
    """Create an interactive TTY exec running bash (falling back to sh)."""
    api = get_client().api
    return api.exec_create(
        container_id,
        cmd=["/bin/sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"],
        tty=True,
        stdin=True,
        stdout=True,
        stderr=True,
        environment={"TERM": "xterm-256color"},
    )["Id"]


def exec_start_socket(exec_id: str):
    """Start the exec and return (holder, raw_socket) for bidirectional I/O."""
    sock = get_client().api.exec_start(exec_id, tty=True, detach=False, stream=False, socket=True)
    raw = getattr(sock, "_sock", sock)
    return sock, raw


def exec_resize(exec_id: str, rows: int, cols: int) -> None:
    get_client().api.exec_resize(exec_id, height=rows, width=cols)
