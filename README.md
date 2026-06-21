# HomeDeck 🛰️

A self-hosted web dashboard to manage a homelab from the browser — Docker
containers, host apps, system health, and an app-store-style installer for both
Debian (APT) packages and Docker apps, with full pre-install configuration and
edit-after-install. Reachable over your LAN and via Tailscale.

> **Status:** Phases 1–3 complete — backend + frontend shell, auth and first-run
> setup wizard, SQLite, connectivity detection, systemd packaging, full Docker
> container management (list/actions/logs/inspect with live status and log
> streaming over WebSocket), and live system metrics with 24h history charts.
> Health checks and the app stores land in later phases (see [Roadmap](#roadmap)).

## Stack

- **Backend:** Python 3.11+ · FastAPI · SQLModel/SQLite · runs **on the host** as a
  systemd service (not containerized) so it can reach the Docker socket, apt, and
  host metrics directly.
- **Frontend:** React · Vite · TypeScript · Tailwind CSS v4 — built to static assets
  and served by FastAPI (single origin, no CORS).
- **Target host:** Debian 12 "Bookworm".

## Requirements (host)

- Debian 12 Bookworm, Python 3.11+, Docker, and the current user in the `docker` group.
- System packages (Bookworm main): `python3-venv`, `appstream` (Phase 6), and `gh`
  (only for creating/pushing the GitHub repo):
  ```bash
  sudo apt-get update && sudo apt-get install -y python3-venv appstream gh
  ```
- Node.js (for building the frontend). Recommended via [nvm](https://github.com/nvm-sh/nvm):
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  nvm install 22
  ```

## Install (production: systemd service)

```bash
git clone git@github.com:cat-petter/homedeck.git
cd homedeck
cp config.example.yaml config.yaml   # edit as needed
./install.sh                         # venv + deps + frontend build + systemd unit
```

`install.sh` runs as your normal user (must be in `docker`); it uses `sudo` only to
install/enable the systemd unit. Then browse to `http://<host>:8770` and complete the
first-run setup wizard to create the admin account. (Port 8770 is the default — set
`server.port` in `config.yaml` to change it.)

- Status / logs: `sudo systemctl status homedeck` · `sudo journalctl -u homedeck -f`

## Development

Run the backend and the Vite dev server separately; the dev server proxies `/api`
to the backend, so the browser uses a single origin.

```bash
# 1) Backend
python3 -m venv --system-site-packages .venv   # --system-site-packages → host python-apt
source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend && python -m homedeck               # http://0.0.0.0:8770

# 2) Frontend (separate terminal)
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
cd frontend && npm install
npm run dev -- --host 0.0.0.0                   # http://0.0.0.0:5173
```

## Configuration

- Copy `config.example.yaml` → `config.yaml` (git-ignored; host-specific).
- Override any value with `HOMEDECK_`-prefixed env vars using `__` for nesting, e.g.
  `HOMEDECK_SERVER__PORT=9000`. A `.env` file in the repo root is loaded automatically.
- Precedence: built-in defaults < `config.yaml` < environment.

## Accessing over LAN and Tailscale

The server binds `0.0.0.0`, so it's reachable at:

- **LAN:** `http://<lan-ip>:8770` (the dashboard detects and shows your LAN IP).
- **Tailscale:** `http://<tailscale-ip>:8770` or via MagicDNS
  `http://<machine>.<tailnet>.ts.net:8770`. The dashboard auto-detects and displays
  the Tailscale IP / MagicDNS name when the `tailscale` CLI is present.

Tailscale already provides encrypted, identity-bound access across your tailnet, so
HTTPS is optional. For direct-LAN hardening you can enable self-signed HTTPS under
`server.https` in `config.yaml`.

## Security & privilege

- Local username/password auth (**Argon2** hashing), **server-side sessions** stored in
  SQLite with an HttpOnly session cookie (supports real logout/revocation; no signing
  secret stored on disk). First-run wizard creates the admin account.
- All mutating actions require authentication; destructive Docker/apt actions require a
  confirm step.
- **Privilege level:** the service runs as your normal host user (in the `docker`
  group) — enough for Docker management and host metrics without root. The **APT app
  store (Phase 6)** will require additional elevation for `apt install/remove`; the
  exact model (run-as-root vs. scoped sudoers) is documented when that phase lands.
- Secrets, password hashes, session tokens, and the populated DB are **never** committed
  (`config.yaml`, `.env`, `data/`, keys/certs are git-ignored).

## Roadmap

| Phase | Feature |
|------:|---------|
| 1 ✅ | Scaffold: FastAPI + static serving, React shell, auth + setup wizard, SQLite, install/systemd |
| 2 ✅ | Docker container management (list/actions/logs/inspect) + live status & log streaming via WebSocket |
| 3 ✅ | System metrics (live CPU/RAM/swap/disk/net/load via psutil + 24h history charts) |
| 4 | Service health/uptime engine + quick-launch tiles |
| 5 | Docker app store: catalog importer → normalize/dedup → config form → compose → deploy → manage → Docker Hub fallback |
| 6 | APT app store: python-apt/AppStream browse → install/remove/upgrade with live output |
| 7 | Polish: dark/light, mobile, error states, sync summary UI, docs |

## Catalog attribution & licenses

The Docker app store (Phase 5) imports and normalizes public catalogs
(Portainer app templates, CasaOS AppStore) and falls back to live Docker Hub
inspection. Per-template source attribution is retained and upstream licenses are
respected. Specific attributions and license notes will be listed here when the
importer lands.

## License

TBD.
