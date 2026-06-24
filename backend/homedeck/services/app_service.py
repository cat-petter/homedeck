"""Deploy and manage Docker apps installed from the app store.

Each installed app is a single-service compose project written under
``data/apps/<name>/docker-compose.yml`` and driven with the ``docker compose``
CLI. We keep the full install config in the DB so an app can be reconfigured
(re-rendered + recreated) or removed later. When the install config carries a
Web UI URL we also auto-create a quick-launch tile (a launch-only Service).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

from sqlmodel import select

from ..config import REPO_ROOT
from ..db import session_scope
from ..models import InstalledApp, Service, utcnow
from . import compose_service as compose
from . import docker_service as dsvc

# Compose ops can pull images; give them generous headroom.
_UP_TIMEOUT = 900
_DOWN_TIMEOUT = 180


class DeployError(RuntimeError):
    """A compose operation failed; ``output`` holds the captured CLI output."""

    def __init__(self, message: str, output: str = "") -> None:
        super().__init__(message)
        self.output = output


def apps_dir() -> Path:
    d = REPO_ROOT / "data" / "apps"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _app_dir(name: str) -> Path:
    return apps_dir() / name


# --- Compose CLI ------------------------------------------------------------

def _run_compose(args: list[str], cwd: Path, timeout: int) -> str:
    """Run `docker compose <args>` in cwd; return combined output or raise."""
    try:
        proc = subprocess.run(
            ["docker", "compose", *args],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise DeployError(f"docker compose not found: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or "") + (exc.stderr or "")
        raise DeployError(f"docker compose timed out after {timeout}s", out) from exc
    output = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        raise DeployError(f"docker compose exited {proc.returncode}", output)
    return output


# --- Quick-launch tile ------------------------------------------------------

def _sync_tile(db, app: InstalledApp, config: dict[str, Any]) -> int | None:
    """Create/update the launch-only Service tile for an app, return its id."""
    lan = str(config.get("web_ui_lan") or "").strip()
    ts = str(config.get("web_ui_tailscale") or "").strip()
    svc: Service | None = db.get(Service, app.service_id) if app.service_id else None
    if not lan and not ts:
        # No Web UI configured; drop any existing tile.
        if svc:
            db.delete(svc)
        return None
    if svc is None:
        svc = Service(check_type="none", category="Apps")
        db.add(svc)
    svc.name = app.title or app.name
    svc.icon = app.icon or ""
    svc.lan_url = lan
    svc.tailscale_url = ts
    db.flush()
    return svc.id


# --- Serialization ----------------------------------------------------------

def _to_dict(app: InstalledApp, status: str | None = None) -> dict[str, Any]:
    return {
        "id": app.id,
        "name": app.name,
        "title": app.title,
        "image": app.image,
        "icon": app.icon,
        "web_ui_lan": app.web_ui_lan,
        "web_ui_tailscale": app.web_ui_tailscale,
        "template_id": app.template_id,
        "service_id": app.service_id,
        "status": status or app.status,
        "last_error": app.last_error,
        "created_at": app.created_at.isoformat() if app.created_at else None,
        "updated_at": app.updated_at.isoformat() if app.updated_at else None,
    }


def _live_status(name: str) -> str:
    """Status of the app's compose project (works for single- and multi-service).

    Every managed app is deployed as `docker compose -p <name>`, so its containers
    carry the project label — match on that rather than container name.
    """
    try:
        client = dsvc.get_client()
        matches = client.containers.list(
            all=True, filters={"label": f"com.docker.compose.project={name}"}
        )
        if not matches:
            return "stopped"
        return "running" if any(c.status == "running" for c in matches) else "stopped"
    except Exception:  # noqa: BLE001 - status is best-effort
        return "unknown"


# --- Public API -------------------------------------------------------------

def list_apps() -> list[dict[str, Any]]:
    with session_scope() as db:
        apps = db.exec(select(InstalledApp).order_by(InstalledApp.created_at)).all()
        return [_to_dict(a, status=_live_status(a.name)) for a in apps]


def get_app(app_id: int) -> dict[str, Any] | None:
    with session_scope() as db:
        a = db.get(InstalledApp, app_id)
        if a is None:
            return None
        out = _to_dict(a, status=_live_status(a.name))
        out["compose_yaml"] = a.compose_yaml
        out["config"] = a.config
        return out


def deploy(template_id: str, config: dict[str, Any], required_env: list[str] | None = None) -> dict[str, Any]:
    """Render, write, and `docker compose up -d` a new app. Raises on bad config."""
    validation = compose.validate(config, required_env=required_env)
    if not validation["ok"]:
        msgs = "; ".join(i["message"] for i in validation["issues"] if i["level"] == "error")
        raise DeployError(f"Config has errors: {msgs}")

    name = compose.safe_name(config.get("name") or config.get("title") or "")
    with session_scope() as db:
        if db.exec(select(InstalledApp).where(InstalledApp.name == name)).first():
            raise DeployError(f"An app named '{name}' is already installed.")

    compose_dict = compose.render_compose(config)
    yaml_text = compose.to_yaml(compose_dict)
    target = _app_dir(name)
    target.mkdir(parents=True, exist_ok=True)
    (target / "docker-compose.yml").write_text(yaml_text, encoding="utf-8")

    try:
        output = _run_compose(["-p", name, "up", "-d"], cwd=target, timeout=_UP_TIMEOUT)
    except DeployError as exc:
        # Best-effort cleanup so a failed deploy doesn't leave half-built state.
        try:
            _run_compose(["-p", name, "down"], cwd=target, timeout=_DOWN_TIMEOUT)
        except DeployError:
            pass
        shutil.rmtree(target, ignore_errors=True)
        raise DeployError(str(exc), getattr(exc, "output", "")) from exc

    with session_scope() as db:
        app = InstalledApp(
            name=name,
            title=str(config.get("title") or name),
            image=compose.full_image(config),
            icon=str(config.get("icon") or ""),
            web_ui_lan=str(config.get("web_ui_lan") or ""),
            web_ui_tailscale=str(config.get("web_ui_tailscale") or ""),
            template_id=template_id or "",
            compose_dir=str(target),
            compose_yaml=yaml_text,
            config=config,
            status="running",
        )
        db.add(app)
        db.flush()
        app.service_id = _sync_tile(db, app, config)
        db.add(app)
        db.commit()
        result = _to_dict(app, status="running")
    result["output"] = output
    return result


def _host_ports(config: dict[str, Any]) -> set[int]:
    out: set[int] = set()
    for p in config.get("ports") or []:
        hp = str(p.get("host_port") or "").strip()
        if hp.isdigit():
            out.add(int(hp))
    return out


def deploy_compose(
    name: str,
    compose_yaml: str,
    *,
    title: str = "",
    icon: str = "",
    web_ui_lan: str = "",
    web_ui_tailscale: str = "",
    template_id: str = "",
) -> dict[str, Any]:
    """Deploy a user-reviewed multi-service compose file verbatim.

    Used for 'stack' templates whose compose comes from a git repo. We write the
    YAML as-is and `docker compose up -d` it, registering the project as a
    managed app so it can be removed later.
    """
    name = compose.safe_name(name)
    if not compose_yaml.strip():
        raise DeployError("Compose file is empty.")
    with session_scope() as db:
        if db.exec(select(InstalledApp).where(InstalledApp.name == name)).first():
            raise DeployError(f"An app named '{name}' is already installed.")

    target = _app_dir(name)
    target.mkdir(parents=True, exist_ok=True)
    (target / "docker-compose.yml").write_text(compose_yaml, encoding="utf-8")

    try:
        output = _run_compose(["-p", name, "up", "-d"], cwd=target, timeout=_UP_TIMEOUT)
    except DeployError as exc:
        try:
            _run_compose(["-p", name, "down"], cwd=target, timeout=_DOWN_TIMEOUT)
        except DeployError:
            pass
        shutil.rmtree(target, ignore_errors=True)
        raise DeployError(str(exc), getattr(exc, "output", "")) from exc

    config = {"web_ui_lan": web_ui_lan, "web_ui_tailscale": web_ui_tailscale}
    with session_scope() as db:
        app = InstalledApp(
            name=name,
            title=title or name,
            image="(compose stack)",
            icon=icon,
            web_ui_lan=web_ui_lan,
            web_ui_tailscale=web_ui_tailscale,
            template_id=template_id or "",
            compose_dir=str(target),
            compose_yaml=compose_yaml,
            config=config,
            status="running",
        )
        db.add(app)
        db.flush()
        app.service_id = _sync_tile(db, app, config)
        db.add(app)
        db.commit()
        result = _to_dict(app, status="running")
    result["output"] = output
    return result


def redeploy(app_id: int, config: dict[str, Any], required_env: list[str] | None = None) -> dict[str, Any]:
    """Re-render an existing app with a new config and recreate it in place."""
    with session_scope() as db:
        app = db.get(InstalledApp, app_id)
        if app is None:
            raise DeployError("App not found.")
        name = app.name
        target = Path(app.compose_dir or _app_dir(name))
        own_ports = _host_ports(app.config or {})

    # The app's own currently-bound ports shouldn't count as conflicts.
    validation = compose.validate(config, required_env=required_env, ignore_host_ports=own_ports)
    if not validation["ok"]:
        msgs = "; ".join(i["message"] for i in validation["issues"] if i["level"] == "error")
        raise DeployError(f"Config has errors: {msgs}")

    # Keep the project name stable so compose recreates rather than duplicates.
    config = {**config, "name": name}
    yaml_text = compose.to_yaml(compose.render_compose(config))
    target.mkdir(parents=True, exist_ok=True)
    (target / "docker-compose.yml").write_text(yaml_text, encoding="utf-8")
    output = _run_compose(["-p", name, "up", "-d"], cwd=target, timeout=_UP_TIMEOUT)

    with session_scope() as db:
        app = db.get(InstalledApp, app_id)
        app.title = str(config.get("title") or name)
        app.image = compose.full_image(config)
        app.icon = str(config.get("icon") or "")
        app.web_ui_lan = str(config.get("web_ui_lan") or "")
        app.web_ui_tailscale = str(config.get("web_ui_tailscale") or "")
        app.compose_yaml = yaml_text
        app.config = config
        app.status = "running"
        app.last_error = None
        app.updated_at = utcnow()
        app.service_id = _sync_tile(db, app, config)
        db.add(app)
        db.commit()
        result = _to_dict(app, status="running")
    result["output"] = output
    return result


def set_running(app_id: int, running: bool) -> dict[str, Any]:
    """Start or stop an installed app's containers."""
    with session_scope() as db:
        app = db.get(InstalledApp, app_id)
        if app is None:
            raise DeployError("App not found.")
        name, target = app.name, Path(app.compose_dir or _app_dir(app.name))
    args = ["-p", name, "start"] if running else ["-p", name, "stop"]
    output = _run_compose(args, cwd=target, timeout=_DOWN_TIMEOUT)
    with session_scope() as db:
        app = db.get(InstalledApp, app_id)
        app.status = "running" if running else "stopped"
        app.updated_at = utcnow()
        db.add(app)
        db.commit()
        result = _to_dict(app)
    result["output"] = output
    return result


def remove(app_id: int, *, delete_data: bool = False) -> dict[str, Any]:
    """`docker compose down` an app, drop its tile, and forget it."""
    with session_scope() as db:
        app = db.get(InstalledApp, app_id)
        if app is None:
            raise DeployError("App not found.")
        name = app.name
        target = Path(app.compose_dir or _app_dir(name))
        service_id = app.service_id

    args = ["-p", name, "down"]
    if delete_data:
        args.append("-v")
    output = ""
    try:
        output = _run_compose(args, cwd=target, timeout=_DOWN_TIMEOUT)
    except DeployError as exc:
        output = getattr(exc, "output", "") or str(exc)

    shutil.rmtree(target, ignore_errors=True)
    with session_scope() as db:
        app = db.get(InstalledApp, app_id)
        if app:
            db.delete(app)
        if service_id is not None:
            svc = db.get(Service, service_id)
            if svc:
                db.delete(svc)
        db.commit()
    return {"ok": True, "output": output}
