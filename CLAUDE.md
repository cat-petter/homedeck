# CLAUDE.md — HomeDeck

Context for any future Claude session (desktop, CLI, or web). Session history is
siloed across surfaces, so this file is the source of truth for how the project
is set up and how to work in it.

## What this is

**HomeDeck** is a self-hosted web dashboard to manage a homelab from a browser,
reachable over LAN and Tailscale. It manages Docker containers, host apps, system
health, and provides an app-store-style installer for both APT packages (Debian)
and Docker apps, with full pre-install configuration and edit-after-install.

## Target host (this box)

- **Debian 12 "Bookworm"**, Linux 6.1 LTS, amd64. Target Bookworm throughout.
- If a package isn't in Bookworm main, prefer **bookworm-backports** and flag it.
  **Never** silently add third-party apt repos.
- Development runs **directly on the target host** over SSH, so Docker socket,
  `python-apt`, systemd, and `psutil` host metrics all work natively — do **not**
  stub or platform-gate Linux-only paths.

### Verified host facts (Phase 1)
- Python 3.11.2, `python-apt` present (system package), git 2.39.5.
- Docker 29.4.0; user `tzvi` is in the `docker` group → socket reachable without sudo.
- GitHub SSH auth works; the SSH key authenticates as GitHub user **`cat-petter`**
  (git config name is `Tweetz100`). Use SSH remote URLs (`git@github.com:...`).
- **`sudo` requires a password** — non-interactive shells can't run privileged
  commands. Hand the user exact `sudo` one-liners; never handle the password.
- Node is provided via **nvm** (Node 22 LTS), per-user, no apt repo. Source it with:
  `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` before any node/npm command.
- Installed via apt by the user (Bookworm main): `gh`, `appstream`, `python3-venv`.

## Architecture (decided — implement as specified)

- **Backend:** Python 3.11+ + FastAPI, runs **on the host** as a systemd service
  (not containerized) so it can reach the Docker socket, apt, and host metrics.
- **Frontend:** React + Vite + TypeScript + Tailwind, built to static assets and
  served by FastAPI (single origin, no CORS).
- **Docker:** Docker SDK for Python against `/var/run/docker.sock`.
- **Metrics:** `psutil` + Docker stats API.
- **APT:** `python-apt` + AppStream (`appstreamcli`/libappstream).
- **DB:** SQLite (SQLModel models).
- **Realtime:** WebSocket endpoints (logs, metrics, status, install output).
- **Config:** `config.yaml` + `HOMEDECK_`-prefixed env overrides (`__` nesting).

## Repo layout

```
backend/        FastAPI app (homedeck package): routers/, services/, models, db, config, security
frontend/       React + Vite + TS + Tailwind v4
catalog/        curated overrides + "Featured" lists; Portainer/CasaOS importer (Phase 5)
data/           SQLite DB + history (git-ignored)
install.sh      venv + deps + frontend build + systemd registration
homedeck.service systemd unit TEMPLATE (install.sh substitutes user/paths)
config.example.yaml, .env.example
```

### Backend specifics
- Entry: `python -m homedeck` (see `backend/homedeck/main.py:run`).
- Settings: `backend/homedeck/config.py`. Precedence defaults < `config.yaml` < env.
  The venv is created with `--system-site-packages` so the host `apt` module imports.
- Auth: Argon2 password hashing (`argon2-cffi`), **server-side sessions** stored in
  SQLite (`auth_sessions`), opaque token in an HttpOnly cookie (no signing secret on
  disk; supports server-side logout/revocation). See `security.py`.
- First-run setup wizard: `GET /api/setup/status`, `POST /api/setup` (only while no
  user exists). Then `/api/auth/login|logout|me`.

### Frontend specifics
- Tailwind **v4** via `@tailwindcss/vite`; manual dark mode through a `.dark` class
  on `<html>` (`@custom-variant dark` in `index.css`), dark is the default.
- Dev server binds `0.0.0.0:5173` and proxies `/api` → `127.0.0.1:8770` (single origin).
- Build output `frontend/dist/` is git-ignored; FastAPI serves it when present, else
  a dev placeholder.

## How to run (dev)

```bash
# Backend (after `sudo apt-get install -y python3-venv` and ./install.sh, or manual venv):
source .venv/bin/activate
cd backend && python -m homedeck                   # serves on 0.0.0.0:8770
# (package lives at backend/homedeck, so run from backend/ — app paths use __file__)

# Frontend (separate terminal):
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
cd frontend && npm run dev -- --host 0.0.0.0       # 0.0.0.0:5173, proxies /api
```

## Security / privilege model

- All mutating actions require auth; destructive Docker/apt actions need a confirm step.
- The service currently runs as the normal host user (`tzvi`), in the `docker` group —
  least privilege for Phases 1–5. **APT install/remove (Phase 6) needs root**; that
  elevation model (run-as-root vs. scoped sudoers) is an open decision to settle when
  Phase 6 lands. Flag privilege/security tradeoffs to the user.
- Never commit secrets, password hashes, session tokens, or the populated DB — even to
  the private repo. `config.yaml`, `.env`, `data/`, keys/certs are git-ignored.

## Git / GitHub

- Repo is **private** (`gh repo create homedeck --private`). Never make it public.
- Use SSH remotes. Commit per build phase with clear messages (rollback-friendly).
- `.gitignore` / `.gitattributes` exist (LF enforced; `*.sh` and `*.service` stay LF).

## Build plan (incremental — finish each phase before the next)

1. **Scaffold** ✅ — prereqs, structure, FastAPI+static, React shell, auth+setup wizard,
   SQLite, install.sh, git init, private GitHub repo + push.
2. **Docker management** ✅ — list/actions/logs/inspect + live status & log
   streaming via WebSocket. Service: `services/docker_service.py`; router:
   `routers/docker.py` (REST + `ws/status`, `ws/logs/{id}`). WS auth via the
   session cookie (`get_user_from_token`). Stats gathered concurrently (each
   `stats(stream=False)` blocks ~1s). Stretch goal (web exec/terminal) deferred.
3. **System metrics** ✅ — live CPU/RAM/swap/disk/net/load/uptime via `psutil`
   (`services/metrics_service.py`). A single background collector loop (started in
   the app lifespan) owns all sampling so rate metrics stay consistent; it caches
   the latest snapshot for `GET /api/metrics/current` and `ws/metrics`, and writes
   a `MetricSample` row every 15s with 24h retention for `GET /api/metrics/history`.
   Frontend `/system` page: live cards + dependency-free SVG `LineChart` (no chart
   lib) + per-container breakdown reusing the docker status WS.
4. Health engine + quick-launch tiles.
5. Docker app store: importer → normalization/dedup → config form → compose → deploy → manage → Hub fallback.
6. APT app store: python-apt/AppStream browse → install/remove/upgrade with live output.
7. Polish: dark/light, mobile, error states, sync summary UI, docs.

## Guardrails

- Target Bookworm; flag anything assuming Trixie or relying on backports.
- GitHub repo must stay PRIVATE.
- Confirm step before any destructive Docker/apt action.
- Don't fabricate working catalog templates; rely on the importer + a small validated
  curated set, clearly marked extensible. Keep source attribution; respect licenses.
- Image match → merge; name-only match → group as variants (never auto-merge variants).
- Never handle tokens/passwords in plaintext; surface privilege/security tradeoffs.
- Surface real system/apt/docker errors verbatim — no silent failures.
