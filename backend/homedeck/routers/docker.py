"""Docker container management: REST actions + WebSocket live status/logs."""

from __future__ import annotations

import asyncio
import threading
from contextlib import contextmanager
from typing import Any

from docker.errors import APIError, NotFound
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..db import session_scope
from ..models import User
from ..security import get_current_user, get_user_from_token
from ..services import docker_service as dsvc
from ..services.docker_service import DockerUnavailable

router = APIRouter(prefix="/api/docker", tags=["docker"])

STATUS_INTERVAL_SECONDS = 3.0
# Each stats read blocks ~1s; collect them concurrently. Stays under docker-py's
# default connection pool (25).
MAX_STATS_CONCURRENCY = 16


# --- Error translation ------------------------------------------------------

@contextmanager
def docker_errors():
    """Map Docker SDK / daemon errors to HTTP responses, surfacing real messages."""
    try:
        yield
    except NotFound as exc:
        raise HTTPException(status_code=404, detail=exc.explanation or str(exc))
    except DockerUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Docker daemon unreachable: {exc}")
    except APIError as exc:
        raise HTTPException(status_code=502, detail=exc.explanation or str(exc))


# --- Schemas ----------------------------------------------------------------

class ActionResult(BaseModel):
    ok: bool
    action: str
    id: str


# --- REST: list / inspect / logs -------------------------------------------

@router.get("/containers")
def list_containers(
    all: bool = Query(default=True, description="Include stopped containers"),
    _user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    with docker_errors():
        return dsvc.list_containers(all_=all)


@router.get("/networks")
def list_networks(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    with docker_errors():
        return {"options": dsvc.network_options()}


@router.get("/containers/{container_id}/inspect")
def inspect_container(
    container_id: str,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    with docker_errors():
        return dsvc.inspect(container_id)


@router.get("/containers/{container_id}/logs")
def container_logs(
    container_id: str,
    tail: int = Query(default=200, ge=1, le=5000),
    timestamps: bool = False,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    with docker_errors():
        return {"id": container_id, "logs": dsvc.recent_logs(container_id, tail=tail, timestamps=timestamps)}


# --- REST: actions ----------------------------------------------------------

def _action(name: str, fn, container_id: str) -> ActionResult:
    with docker_errors():
        fn(container_id)
    return ActionResult(ok=True, action=name, id=container_id)


@router.post("/containers/{container_id}/start", response_model=ActionResult)
def start_container(container_id: str, _user: User = Depends(get_current_user)) -> ActionResult:
    return _action("start", dsvc.start, container_id)


@router.post("/containers/{container_id}/stop", response_model=ActionResult)
def stop_container(container_id: str, _user: User = Depends(get_current_user)) -> ActionResult:
    return _action("stop", dsvc.stop, container_id)


@router.post("/containers/{container_id}/restart", response_model=ActionResult)
def restart_container(container_id: str, _user: User = Depends(get_current_user)) -> ActionResult:
    return _action("restart", dsvc.restart, container_id)


@router.post("/containers/{container_id}/pause", response_model=ActionResult)
def pause_container(container_id: str, _user: User = Depends(get_current_user)) -> ActionResult:
    return _action("pause", dsvc.pause, container_id)


@router.post("/containers/{container_id}/unpause", response_model=ActionResult)
def unpause_container(container_id: str, _user: User = Depends(get_current_user)) -> ActionResult:
    return _action("unpause", dsvc.unpause, container_id)


@router.delete("/containers/{container_id}", response_model=ActionResult)
def remove_container(
    container_id: str,
    force: bool = Query(default=False, description="Force-remove a running container"),
    volumes: bool = Query(default=False, description="Also remove anonymous volumes"),
    _user: User = Depends(get_current_user),
) -> ActionResult:
    # Destructive: the UI requires an explicit confirm before calling this.
    with docker_errors():
        dsvc.remove(container_id, force=force, remove_volumes=volumes)
    return ActionResult(ok=True, action="remove", id=container_id)


# --- WebSocket auth helper --------------------------------------------------

async def _ws_authenticate(websocket: WebSocket) -> User | None:
    """Authenticate a WebSocket from the session cookie. Returns the user or None."""
    from ..config import get_settings

    token = websocket.cookies.get(get_settings().session.cookie_name)
    # DB lookup is sync; keep it off the event loop.
    def _lookup() -> User | None:
        with session_scope() as db:
            user = get_user_from_token(db, token)
            if user is None:
                return None
            # Detach a lightweight copy; the session closes on exit.
            return User(id=user.id, username=user.username, is_admin=user.is_admin)

    return await asyncio.to_thread(_lookup)


# --- WebSocket: live status (all containers) --------------------------------

@router.websocket("/ws/status")
async def ws_status(websocket: WebSocket) -> None:
    await websocket.accept()
    user = await _ws_authenticate(websocket)
    if user is None:
        await websocket.close(code=4401)  # application "unauthorized"
        return

    # Bound concurrent stats reads so we don't exhaust the SDK's connection pool.
    stats_sem = asyncio.Semaphore(MAX_STATS_CONCURRENCY)

    try:
        while True:
            try:
                containers = await asyncio.to_thread(_list_objects)
            except DockerUnavailable as exc:
                await websocket.send_json({"type": "error", "detail": f"Docker daemon unreachable: {exc}"})
                await asyncio.sleep(STATUS_INTERVAL_SECONDS)
                continue

            summaries = [dsvc.summarize(c) for c in containers]
            summaries.sort(key=lambda c: (c["state"] != "running", c["name"].lower()))
            # Send the (fast) container list immediately.
            await websocket.send_json({"type": "snapshot", "containers": summaries})

            # Gather live stats concurrently — each stats read blocks ~1s, so
            # sequential would be unusable with many containers.
            running = [c for c in containers if c.status == "running"]
            results = await asyncio.gather(
                *(_stats_one(c, stats_sem) for c in running), return_exceptions=True
            )
            stats = [r for r in results if isinstance(r, dict)]
            await websocket.send_json({"type": "stats", "stats": stats})

            await asyncio.sleep(STATUS_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        return
    except RuntimeError:
        # Send after disconnect; treat as closed.
        return


def _list_objects():
    from docker.errors import DockerException

    try:
        return dsvc.get_client().containers.list(all=True)
    except DockerException as exc:
        raise DockerUnavailable(str(exc)) from exc


async def _stats_one(container, sem: asyncio.Semaphore) -> dict[str, Any] | None:
    async with sem:
        try:
            return await asyncio.to_thread(dsvc.stats_snapshot, container)
        except Exception:  # noqa: BLE001 - a container may vanish; skip it
            return None


# --- WebSocket: live logs (single container) --------------------------------

@router.websocket("/ws/logs/{container_id}")
async def ws_logs(websocket: WebSocket, container_id: str, tail: int = 200) -> None:
    await websocket.accept()
    user = await _ws_authenticate(websocket)
    if user is None:
        await websocket.close(code=4401)
        return

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=1000)
    stop = threading.Event()
    stream_holder: dict[str, Any] = {}

    def _reader() -> None:
        try:
            stream = dsvc.log_stream(container_id, tail=tail)
            stream_holder["stream"] = stream
            for chunk in stream:
                if stop.is_set():
                    break
                line = chunk.decode("utf-8", errors="replace") if isinstance(chunk, bytes) else str(chunk)
                loop.call_soon_threadsafe(queue.put_nowait, line)
        except NotFound:
            loop.call_soon_threadsafe(queue.put_nowait, "__ERROR__:Container not found")
        except (DockerUnavailable, APIError) as exc:
            loop.call_soon_threadsafe(queue.put_nowait, f"__ERROR__:{exc}")
        except Exception as exc:  # noqa: BLE001 - surface anything else, don't hang
            loop.call_soon_threadsafe(queue.put_nowait, f"__ERROR__:{exc}")
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)  # sentinel: stream ended

    thread = threading.Thread(target=_reader, name=f"logs-{container_id[:12]}", daemon=True)
    thread.start()

    async def _pump() -> None:
        while True:
            item = await queue.get()
            if item is None:
                await websocket.send_json({"type": "end"})
                return
            if item.startswith("__ERROR__:"):
                await websocket.send_json({"type": "error", "detail": item[len("__ERROR__:"):]})
                return
            await websocket.send_json({"type": "line", "data": item})

    # Detect client disconnect by awaiting receive concurrently with the pump.
    async def _watch_disconnect() -> None:
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            return

    pump_task = asyncio.create_task(_pump())
    watch_task = asyncio.create_task(_watch_disconnect())
    try:
        await asyncio.wait({pump_task, watch_task}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        stop.set()
        stream = stream_holder.get("stream")
        if stream is not None and hasattr(stream, "close"):
            try:
                stream.close()  # unblocks the reader thread's socket read
            except Exception:  # noqa: BLE001
                pass
        for t in (pump_task, watch_task):
            t.cancel()
        try:
            await websocket.close()
        except RuntimeError:
            pass
