"""APT app store: browse the host package universe (read-only, Phase 6 part 1).

Install/remove/upgrade land later behind the scoped sudoers helper + install
password.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from ..models import User
from ..security import authenticate_websocket, get_current_user
from ..services import apt_service as asvc
from ..services import install_auth

router = APIRouter(prefix="/api/apt", tags=["apt"])


@router.get("/status")
async def status(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    return await asyncio.to_thread(asvc.status)


@router.get("/packages")
async def packages(
    search: str = "",
    installed: bool = False,
    upgradable: bool = False,
    limit: int = Query(default=60, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return await asyncio.to_thread(
        asvc.search, search, installed, upgradable, limit, offset
    )


@router.get("/packages/{name}")
async def package(name: str, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    try:
        detail = await asyncio.to_thread(asvc.package_detail, name)
    except asvc.AptUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"APT is busy: {exc}")
    if detail is None:
        raise HTTPException(status_code=404, detail="Package not found")
    return detail


# --- WebSocket: run a privileged apt operation, streaming output ------------

@router.websocket("/ws/run")
async def ws_run(websocket: WebSocket) -> None:
    """Install/remove/upgrade with live output.

    Auth is two-factor: the session cookie (logged-in user) plus the app-level
    install password, sent in the first message. We do NOT kill the operation on
    client disconnect — interrupting dpkg mid-transaction is dangerous; we let it
    finish.
    """
    await websocket.accept()
    user = await authenticate_websocket(websocket)
    if user is None:
        await websocket.close(code=4401)
        return

    try:
        msg = await websocket.receive_json()
    except Exception:  # noqa: BLE001 - bad/empty first frame
        await websocket.close()
        return

    verb = str(msg.get("verb") or "")
    packages = [str(p) for p in (msg.get("packages") or [])]
    password = str(msg.get("password") or "")

    if not install_auth.verify(password):
        await websocket.send_json({"type": "error", "detail": "Install password is incorrect."})
        await websocket.close()
        return
    try:
        asvc.validate(verb, packages)
    except asvc.AptCommandError as exc:
        await websocket.send_json({"type": "error", "detail": str(exc)})
        await websocket.close()
        return

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

    def _reader() -> None:
        try:
            proc = asvc.popen(verb, packages)
            assert proc.stdout is not None
            for line in proc.stdout:
                loop.call_soon_threadsafe(queue.put_nowait, ("line", line.rstrip("\n")))
            loop.call_soon_threadsafe(queue.put_nowait, ("end", proc.wait()))
        except FileNotFoundError as exc:
            loop.call_soon_threadsafe(queue.put_nowait, ("error", f"Helper not installed: {exc}"))
            loop.call_soon_threadsafe(queue.put_nowait, ("end", 127))
        except Exception as exc:  # noqa: BLE001 - surface anything, don't hang
            loop.call_soon_threadsafe(queue.put_nowait, ("error", str(exc)))
            loop.call_soon_threadsafe(queue.put_nowait, ("end", 1))

    threading.Thread(target=_reader, name=f"apt-{verb}", daemon=True).start()

    try:
        while True:
            kind, data = await queue.get()
            if kind == "line":
                await websocket.send_json({"type": "line", "data": data})
            elif kind == "error":
                await websocket.send_json({"type": "error", "detail": data})
            elif kind == "end":
                if data == 0:
                    await asyncio.to_thread(asvc.refresh)  # reflect new package state
                await websocket.send_json({"type": "end", "code": data})
                break
    except WebSocketDisconnect:
        return
    except RuntimeError:
        return
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass
