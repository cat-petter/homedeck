"""Service health/uptime engine.

A single scheduler loop (started in the app lifespan) runs each enabled service's
check on its configured interval, records a ServiceCheckResult, and updates the
service's cached latest status. Checks:

  - http: GET the target URL; up if the status is in the expected range.
  - tcp:  open a TCP connection to host:port; up if it connects.
  - ping: real ICMP via the system `ping` binary (works unprivileged on Debian).

A check that connects but is slower than ``degraded_ms`` is marked "degraded".
"""

from __future__ import annotations

import asyncio
import re
import ssl
import time
import urllib.error
import urllib.request
from datetime import timedelta
from typing import Any

from sqlalchemy import delete
from sqlmodel import select

from ..db import session_scope
from ..models import Service, ServiceCheckResult, utcnow

SCHEDULER_TICK_SECONDS = 1.0
RESULT_RETENTION = timedelta(days=7)
_PRUNE_EVERY_SECONDS = 300.0

_last_run: dict[int, float] = {}
_task: asyncio.Task | None = None
_PING_TIME_RE = re.compile(r"time[=<]([\d.]+)\s*ms")


# --- Status range helpers ---------------------------------------------------

def _status_ok(code: int, expected: str) -> bool:
    expected = (expected or "").strip()
    if not expected:
        return 200 <= code < 400
    if "-" in expected:
        lo, _, hi = expected.partition("-")
        try:
            return int(lo) <= code <= int(hi)
        except ValueError:
            return 200 <= code < 400
    try:
        return code == int(expected)
    except ValueError:
        return 200 <= code < 400


# --- Individual checks (return (status, response_ms, error)) ----------------

def _http_check_blocking(url: str, timeout: float, verify_tls: bool, expected: str) -> tuple[str, float | None, str | None]:
    ctx = ssl.create_default_context()
    if not verify_tls:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": "HomeDeck-health/1.0"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            resp.read(64)
            code = resp.status
        ms = (time.monotonic() - t0) * 1000
        ok = _status_ok(code, expected)
        return ("up" if ok else "down", ms, None if ok else f"HTTP {code}")
    except urllib.error.HTTPError as exc:
        ms = (time.monotonic() - t0) * 1000
        ok = _status_ok(exc.code, expected)
        return ("up" if ok else "down", ms, None if ok else f"HTTP {exc.code}")
    except Exception as exc:  # noqa: BLE001 - any failure means down
        return ("down", None, str(exc) or exc.__class__.__name__)


async def _tcp_check(host: str, port: int, timeout: float) -> tuple[str, float | None, str | None]:
    t0 = time.monotonic()
    try:
        reader_writer = asyncio.open_connection(host, port)
        _, writer = await asyncio.wait_for(reader_writer, timeout=timeout)
        ms = (time.monotonic() - t0) * 1000
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
        return ("up", ms, None)
    except (asyncio.TimeoutError, OSError) as exc:
        return ("down", None, str(exc) or "connection failed")


async def _ping_check(host: str, timeout: float) -> tuple[str, float | None, str | None]:
    wait = max(1, int(round(timeout)))
    t0 = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", "1", "-W", str(wait), host,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=wait + 2)
    except FileNotFoundError:
        return ("down", None, "ping binary not found")
    except asyncio.TimeoutError:
        return ("down", None, "timed out")
    if proc.returncode == 0:
        m = _PING_TIME_RE.search(out.decode("utf-8", "replace"))
        ms = float(m.group(1)) if m else (time.monotonic() - t0) * 1000
        return ("up", ms, None)
    msg = (err or out).decode("utf-8", "replace").strip().splitlines()
    return ("down", None, msg[-1] if msg else "no reply")


def _resolve_target(svc: dict[str, Any]) -> str:
    target = (svc.get("check_target") or "").strip()
    if target:
        return target
    # Fall back to a configured URL (handy for http checks).
    return (svc.get("lan_url") or svc.get("tailscale_url") or "").strip()


async def run_check(svc: dict[str, Any]) -> tuple[str, float | None, str | None]:
    ctype = svc["check_type"]
    timeout = float(svc.get("timeout_seconds") or 10)
    target = _resolve_target(svc)
    if not target:
        return ("down", None, "no check target configured")

    if ctype == "http":
        status, ms, err = await asyncio.to_thread(
            _http_check_blocking, target, timeout, bool(svc.get("verify_tls")), svc.get("expected_status") or ""
        )
    elif ctype == "tcp":
        host, _, port_s = target.rpartition(":")
        if not host or not port_s.isdigit():
            return ("down", None, "tcp target must be host:port")
        status, ms, err = await _tcp_check(host, int(port_s), timeout)
    elif ctype == "ping":
        status, ms, err = await _ping_check(target, timeout)
    else:
        return ("unknown", None, None)

    # Slow-but-reachable → degraded.
    degraded_ms = svc.get("degraded_ms")
    if status == "up" and degraded_ms and ms is not None and ms > degraded_ms:
        status = "degraded"
    return status, ms, err


# --- Persistence ------------------------------------------------------------

def _load_enabled() -> list[dict[str, Any]]:
    with session_scope() as db:
        rows = db.exec(select(Service).where(Service.enabled == True)).all()  # noqa: E712
        return [
            {
                "id": s.id,
                "check_type": s.check_type,
                "check_target": s.check_target,
                "lan_url": s.lan_url,
                "tailscale_url": s.tailscale_url,
                "expected_status": s.expected_status,
                "interval_seconds": s.interval_seconds,
                "timeout_seconds": s.timeout_seconds,
                "degraded_ms": s.degraded_ms,
                "verify_tls": s.verify_tls,
            }
            for s in rows
            if s.check_type and s.check_type != "none"
        ]


def _record(service_id: int, status: str, ms: float | None, err: str | None) -> None:
    with session_scope() as db:
        svc = db.get(Service, service_id)
        if svc is None:
            return  # deleted mid-flight
        db.add(ServiceCheckResult(service_id=service_id, status=status, response_ms=ms, error=err))
        svc.last_status = status
        svc.last_checked_at = utcnow()
        svc.last_response_ms = ms
        svc.last_error = err
        db.add(svc)
        db.commit()


def _prune() -> None:
    cutoff = utcnow() - RESULT_RETENTION
    with session_scope() as db:
        db.exec(delete(ServiceCheckResult).where(ServiceCheckResult.ts < cutoff))
        db.commit()


async def check_now(service_id: int) -> dict[str, Any]:
    """Run a single service's check immediately and persist the result."""
    svc_dict = None
    with session_scope() as db:
        s = db.get(Service, service_id)
        if s is None:
            raise KeyError(service_id)
        svc_dict = {
            "id": s.id,
            "check_type": s.check_type,
            "check_target": s.check_target,
            "lan_url": s.lan_url,
            "tailscale_url": s.tailscale_url,
            "expected_status": s.expected_status,
            "timeout_seconds": s.timeout_seconds,
            "degraded_ms": s.degraded_ms,
            "verify_tls": s.verify_tls,
        }
    if svc_dict["check_type"] in ("", "none"):
        return {"status": "unknown", "response_ms": None, "error": None}
    status, ms, err = await run_check(svc_dict)
    await asyncio.to_thread(_record, service_id, status, ms, err)
    _last_run[service_id] = time.monotonic()
    return {"status": status, "response_ms": ms, "error": err}


# --- Scheduler --------------------------------------------------------------

async def _run_and_record(svc: dict[str, Any]) -> None:
    status, ms, err = await run_check(svc)
    await asyncio.to_thread(_record, svc["id"], status, ms, err)


async def _scheduler_loop() -> None:
    last_prune = time.monotonic()
    while True:
        try:
            services = await asyncio.to_thread(_load_enabled)
            now = time.monotonic()
            due = [s for s in services if now - _last_run.get(s["id"], 0.0) >= s["interval_seconds"]]
            for s in due:
                _last_run[s["id"]] = now
            if due:
                await asyncio.gather(*(_run_and_record(s) for s in due), return_exceptions=True)
            if now - last_prune >= _PRUNE_EVERY_SECONDS:
                last_prune = now
                await asyncio.to_thread(_prune)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            import logging

            logging.getLogger("homedeck.health").exception("health scheduler tick failed")
        await asyncio.sleep(SCHEDULER_TICK_SECONDS)


def start_scheduler() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_scheduler_loop())


async def stop_scheduler() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None


# --- History / uptime queries ----------------------------------------------

def get_history(service_id: int, hours: float = 24.0) -> dict[str, Any]:
    cutoff = utcnow() - timedelta(hours=hours)
    with session_scope() as db:
        rows = db.exec(
            select(ServiceCheckResult)
            .where(ServiceCheckResult.service_id == service_id, ServiceCheckResult.ts >= cutoff)
            .order_by(ServiceCheckResult.ts)
        ).all()
    total = len(rows)
    up = sum(1 for r in rows if r.status in ("up", "degraded"))
    samples = [
        {"ts": r.ts.isoformat(), "status": r.status, "response_ms": r.response_ms, "error": r.error}
        for r in rows
    ]
    return {
        "service_id": service_id,
        "hours": hours,
        "uptime_pct": round(up / total * 100, 2) if total else None,
        "checks": total,
        "samples": samples,
    }


def uptime_pct(service_id: int, hours: float = 24.0) -> float | None:
    cutoff = utcnow() - timedelta(hours=hours)
    with session_scope() as db:
        rows = db.exec(
            select(ServiceCheckResult.status).where(
                ServiceCheckResult.service_id == service_id, ServiceCheckResult.ts >= cutoff
            )
        ).all()
    if not rows:
        return None
    up = sum(1 for s in rows if s in ("up", "degraded"))
    return round(up / len(rows) * 100, 2)
