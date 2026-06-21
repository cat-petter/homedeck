"""Host metrics via psutil + a background sampler that records ~24h of history.

A single collector loop owns all sampling so that rate-based metrics (CPU%,
network throughput) are computed from one consistent cadence. Endpoints and the
WebSocket read the cached latest snapshot rather than calling psutil themselves
(psutil.cpu_percent(interval=None) is stateful and would interfere across
callers).
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import timedelta
from typing import Any

import psutil
from sqlalchemy import delete
from sqlmodel import select

from ..db import session_scope
from ..models import MetricSample, utcnow

LIVE_INTERVAL_SECONDS = 2.0
HISTORY_INTERVAL_SECONDS = 15.0
RETENTION = timedelta(hours=24)

# Pseudo / virtual filesystems we don't want to show as "disks".
_PSEUDO_FSTYPES = {
    "tmpfs",
    "devtmpfs",
    "devfs",
    "overlay",
    "aufs",
    "squashfs",
    "iso9660",
    "ramfs",
    "autofs",
    "proc",
    "sysfs",
    "cgroup",
    "cgroup2",
    "pstore",
    "mqueue",
    "debugfs",
    "tracefs",
    "fuse.lxcfs",
    "nsfs",
    "binfmt_misc",
}

_state: dict[str, Any] = {
    "latest": None,
    "prev_net": None,  # (timestamp, bytes_sent, bytes_recv)
}
_task: asyncio.Task | None = None


# --- Computation ------------------------------------------------------------

def _disks() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen_devices: set[str] = set()
    for part in psutil.disk_partitions(all=False):
        if part.fstype in _PSEUDO_FSTYPES or not part.fstype:
            continue
        if part.device in seen_devices:
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except (PermissionError, OSError):
            continue
        seen_devices.add(part.device)
        out.append(
            {
                "device": part.device,
                "mountpoint": part.mountpoint,
                "fstype": part.fstype,
                "total": usage.total,
                "used": usage.used,
                "free": usage.free,
                "percent": usage.percent,
            }
        )
    out.sort(key=lambda d: d["mountpoint"])
    return out


def _net_rates(now: float) -> tuple[float, float, int, int]:
    io = psutil.net_io_counters()
    prev = _state.get("prev_net")
    _state["prev_net"] = (now, io.bytes_sent, io.bytes_recv)
    if prev is None:
        return 0.0, 0.0, io.bytes_recv, io.bytes_sent
    dt = now - prev[0]
    if dt <= 0:
        return 0.0, 0.0, io.bytes_recv, io.bytes_sent
    tx_rate = max(io.bytes_sent - prev[1], 0) / dt
    rx_rate = max(io.bytes_recv - prev[2], 0) / dt
    return rx_rate, tx_rate, io.bytes_recv, io.bytes_sent


def compute_snapshot() -> dict[str, Any]:
    """Compute a full live metrics snapshot (blocking psutil reads)."""
    now = time.time()
    vm = psutil.virtual_memory()
    sm = psutil.swap_memory()
    rx_rate, tx_rate, rx_total, tx_total = _net_rates(now)

    try:
        load1, load5, load15 = os.getloadavg()
    except OSError:  # pragma: no cover - not all platforms
        load1 = load5 = load15 = 0.0

    cpu_pct = psutil.cpu_percent(interval=None)
    per_cpu = psutil.cpu_percent(interval=None, percpu=True)

    boot = psutil.boot_time()
    return {
        "ts": utcnow().isoformat(),
        "cpu": {
            "percent": cpu_pct,
            "per_cpu": per_cpu,
            "count_logical": psutil.cpu_count(logical=True),
            "count_physical": psutil.cpu_count(logical=False),
        },
        "memory": {
            "total": vm.total,
            "used": vm.used,
            "available": vm.available,
            "percent": vm.percent,
        },
        "swap": {"total": sm.total, "used": sm.used, "percent": sm.percent},
        "disks": _disks(),
        "network": {
            "rx_rate": rx_rate,
            "tx_rate": tx_rate,
            "rx_total": rx_total,
            "tx_total": tx_total,
        },
        "load": {"load1": load1, "load5": load5, "load15": load15},
        "uptime_seconds": max(now - boot, 0),
        "boot_time": boot,
    }


# --- History persistence ----------------------------------------------------

def _write_history(snapshot: dict[str, Any]) -> None:
    sample = MetricSample(
        cpu_pct=snapshot["cpu"]["percent"],
        mem_pct=snapshot["memory"]["percent"],
        mem_used=snapshot["memory"]["used"],
        mem_total=snapshot["memory"]["total"],
        swap_pct=snapshot["swap"]["percent"],
        net_rx_rate=snapshot["network"]["rx_rate"],
        net_tx_rate=snapshot["network"]["tx_rate"],
        load1=snapshot["load"]["load1"],
    )
    cutoff = utcnow() - RETENTION
    with session_scope() as db:
        db.add(sample)
        db.exec(delete(MetricSample).where(MetricSample.ts < cutoff))
        db.commit()


def get_history(hours: float = 24.0) -> list[dict[str, Any]]:
    cutoff = utcnow() - timedelta(hours=hours)
    with session_scope() as db:
        rows = db.exec(
            select(MetricSample).where(MetricSample.ts >= cutoff).order_by(MetricSample.ts)
        ).all()
    return [
        {
            "ts": r.ts.isoformat(),
            "cpu_pct": r.cpu_pct,
            "mem_pct": r.mem_pct,
            "mem_used": r.mem_used,
            "mem_total": r.mem_total,
            "swap_pct": r.swap_pct,
            "net_rx_rate": r.net_rx_rate,
            "net_tx_rate": r.net_tx_rate,
            "load1": r.load1,
        }
        for r in rows
    ]


# --- Accessors --------------------------------------------------------------

def latest() -> dict[str, Any]:
    """Return the cached latest snapshot, computing one if the loop hasn't run."""
    snap = _state.get("latest")
    if snap is None:
        snap = compute_snapshot()
        _state["latest"] = snap
    return snap


# --- Background collector ----------------------------------------------------

async def _collector_loop() -> None:
    last_history = 0.0
    # Prime cpu_percent so the first real reading isn't 0.
    psutil.cpu_percent(interval=None)
    psutil.cpu_percent(interval=None, percpu=True)
    while True:
        try:
            snapshot = await asyncio.to_thread(compute_snapshot)
            _state["latest"] = snapshot
            now = time.monotonic()
            if now - last_history >= HISTORY_INTERVAL_SECONDS:
                last_history = now
                await asyncio.to_thread(_write_history, snapshot)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - never let the sampler die silently
            import logging

            logging.getLogger("homedeck.metrics").exception("metrics sampling failed")
        await asyncio.sleep(LIVE_INTERVAL_SECONDS)


def start_collector() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_collector_loop())


async def stop_collector() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
