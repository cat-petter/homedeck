"""HomeDeck FastAPI application: API routers + static SPA serving."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import REPO_ROOT, get_settings
from .db import init_db
from .routers import auth, docker, metrics, system
from .services import metrics_service

settings = get_settings()

# Built frontend assets (frontend/dist). May be absent during dev (use Vite server).
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    metrics_service.start_collector()
    try:
        yield
    finally:
        await metrics_service.stop_collector()


app = FastAPI(title="HomeDeck", version=__version__, lifespan=lifespan)

# --- API routers ------------------------------------------------------------
app.include_router(auth.router)
app.include_router(auth.setup_router)
app.include_router(system.router)
app.include_router(docker.router)
app.include_router(metrics.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "version": __version__}


# --- Static SPA serving -----------------------------------------------------
# API routes are registered above, so they take precedence over the catch-all.

_DEV_PLACEHOLDER = """<!doctype html>
<html><head><meta charset="utf-8"><title>HomeDeck</title>
<style>body{font-family:system-ui;background:#0b0f17;color:#e2e8f0;margin:0;
display:grid;place-items:center;height:100vh}div{max-width:36rem;padding:2rem}
code{background:#1e293b;padding:.15rem .4rem;border-radius:.3rem}</style></head>
<body><div><h1>HomeDeck backend is running</h1>
<p>The frontend hasn't been built yet (<code>frontend/dist</code> not found).</p>
<p>For development, run the Vite dev server in <code>frontend/</code>:
<br><code>npm run dev -- --host 0.0.0.0</code></p>
<p>To serve the built UI from here: <code>npm run build</code> in <code>frontend/</code>,
then reload.</p>
<p>API is live at <code>/api/health</code>.</p></div></body></html>"""


if FRONTEND_DIST.is_dir():
    # Serve hashed asset files directly.
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_catch_all(full_path: str, request: Request):
        # Never swallow API routes (they're matched first, but be defensive).
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        # Serve a real file if it exists (favicon, etc.), else index.html.
        candidate = (FRONTEND_DIST / full_path).resolve()
        if candidate.is_file() and FRONTEND_DIST in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

else:

    @app.get("/", include_in_schema=False)
    def dev_placeholder() -> HTMLResponse:
        return HTMLResponse(_DEV_PLACEHOLDER)


def run() -> None:
    """Entry point for `python -m homedeck` / console script."""
    import uvicorn

    https = settings.server.https
    ssl_kwargs = {}
    if https.enabled and https.cert_file and https.key_file:
        ssl_kwargs = {"ssl_certfile": https.cert_file, "ssl_keyfile": https.key_file}

    uvicorn.run(
        "homedeck.main:app",
        host=settings.server.host,
        port=settings.server.port,
        **ssl_kwargs,
    )


if __name__ == "__main__":
    run()
