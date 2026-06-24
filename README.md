# HomeDeck WIP 🛰️

A self-hosted web dashboard to manage a homelab from the browser — Docker
containers, host apps, system health, and an app-store-style installer for both
Debian (APT) packages and Docker apps, with full pre-install configuration and
edit-after-install. Reachable over your LAN and via Tailscale.

> **Status:** all phases complete. Backend + frontend shell, auth and first-run
> setup wizard, SQLite, connectivity detection, systemd packaging; full Docker
> container management (live status + log streaming over WebSocket); live system
> metrics with 24h history + a storage drill-in; a service health/uptime engine
> (HTTP/TCP/ping) with quick-launch tiles; a **Docker app store** (multi-source
> catalog importer → normalize/dedup → full config form → compose → deploy &
> manage, with Docker Hub fallback and stale-image substitution); an **APT app
> store** (browse/search → install/remove/upgrade with live output); and a
> **Settings** page (catalog sources, image remaps, install password).

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

`install.sh` runs as your normal user (must be in `docker`); it uses `sudo` to
install/enable the systemd unit **and** to install the privileged APT helper +
its scoped sudoers rule (see [Security & privilege](#security--privilege)). Then
browse to `http://<host>:8770` and complete the first-run setup wizard to create
the admin account. (Port 8770 is the default — set `server.port` in `config.yaml`.)

- Status / logs: `sudo systemctl status homedeck` · `sudo journalctl -u homedeck -f`

## App stores

- **Docker** — browse a merged catalog (Portainer-format community lists + the
  CasaOS AppStore), or search **Docker Hub** directly. A full pre-install config
  form (image/tag, ports, volumes, env, network incl. sharing another container's
  netns, devices, caps, limits…) renders a compose file, validates host-port
  conflicts, deploys with `docker compose`, and tracks the app for
  reconfigure/remove. Renamed/removed images are auto-substituted with a
  disclaimer. Sources are managed under **Settings**.
- **APT** — browse/search the host package universe (python-apt), see installed &
  upgradable packages, and install/remove/upgrade with **live streamed output**.
  Privileged operations are gated by a dedicated **install password** and run via
  a scoped helper (below).

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
  group) — enough for Docker management and host metrics without root.
- **APT elevation model:** `apt install/remove/upgrade` needs root, so `install.sh`
  installs one small, root-owned helper (`scripts/homedeck-apt` →
  `/usr/local/lib/homedeck/homedeck-apt`) and a scoped sudoers rule
  (`/etc/sudoers.d/homedeck-apt`) granting the service user **NOPASSWD for only
  that helper**. The helper accepts only `update/install/remove/upgrade` on
  strictly-validated package names (options blocked, no shell) — so the rule can't
  be turned into general root. From the UI, those operations are additionally
  gated by an app-level **install password** (Argon2-hashed). Note this password
  is an app-layer gate (it blocks unauthorized UI/session use), not an OS control;
  the service user is already root-equivalent via the Docker socket, so the helper
  doesn't widen privilege. To remove it all: `sudo rm
  /etc/sudoers.d/homedeck-apt /usr/local/lib/homedeck/homedeck-apt`.
- Secrets, password hashes, session tokens, and the populated DB are **never** committed
  (`config.yaml`, `.env`, `data/`, keys/certs are git-ignored).

## Roadmap

| Phase | Feature |
|------:|---------|
| 1 ✅ | Scaffold: FastAPI + static serving, React shell, auth + setup wizard, SQLite, install/systemd |
| 2 ✅ | Docker container management (list/actions/logs/inspect) + live status & log streaming via WebSocket |
| 3 ✅ | System metrics (live CPU/RAM/swap/disk/net/load via psutil + 24h history charts) |
| 4 ✅ | Service health/uptime engine (HTTP/TCP/ping) + quick-launch tiles |
| 5 ✅ | Docker app store: catalog importer → normalize/dedup → config form → compose → deploy → manage → Docker Hub fallback |
| 6 ✅ | APT app store: python-apt browse → install/remove/upgrade with live output (scoped helper + install password) |
| 7 ✅ | Polish: gear-icon Settings (sources, image remaps, install password), sync summary, mobile nav, docs |

## Catalog attribution & licenses

The Docker app store imports and normalizes public catalogs and falls back to
live Docker Hub inspection. Per-app source attribution is retained (shown in the
detail drawer) and upstream licenses are respected. Default sources (all
toggleable under **Settings**):

- [Portainer official templates](https://github.com/portainer/templates)
- [Lissy93/portainer-templates](https://github.com/Lissy93/portainer-templates)
- [SelfhostedPro/selfhosted_templates](https://github.com/SelfhostedPro/selfhosted_templates)
- [Qballjos/portainer_templates](https://github.com/Qballjos/portainer_templates)
- [CasaOS AppStore](https://github.com/IceWhaleTech/CasaOS-AppStore) (opt-in)

## License

TBD.
