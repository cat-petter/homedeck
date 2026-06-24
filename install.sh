#!/usr/bin/env bash
#
# HomeDeck installer.
#   - Creates a Python venv (with --system-site-packages so the host's python-apt
#     is importable) and installs backend dependencies.
#   - Builds the frontend if Node/npm is available.
#   - Renders and installs the systemd unit, then enables + starts the service.
#
# Run as the normal host user that should OWN the service (must be in the
# `docker` group). Privileged steps (systemd) use sudo and will prompt.
#
#   ./install.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${REPO_ROOT}/.venv"
SERVICE_USER="$(id -un)"
SERVICE_NAME="homedeck"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# --- Sanity checks ----------------------------------------------------------
[ "$(id -u)" -eq 0 ] && die "Run this as your normal user, not root (sudo is used only where needed)."
command -v python3 >/dev/null 2>&1 || die "python3 not found."
python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' \
    || die "Python 3.11+ required."
python3 -c 'import ensurepip' 2>/dev/null \
    || die "python3-venv (ensurepip) missing. Install with: sudo apt-get install -y python3-venv"

if ! id -nG "$SERVICE_USER" | tr ' ' '\n' | grep -qx docker; then
    warn "User '$SERVICE_USER' is not in the 'docker' group. Docker management will fail."
    warn "Fix with: sudo usermod -aG docker $SERVICE_USER  (then log out/in)"
fi

# --- Python venv + deps -----------------------------------------------------
log "Creating venv at $VENV_DIR (with --system-site-packages for python-apt)"
python3 -m venv --system-site-packages "$VENV_DIR"
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
log "Installing backend dependencies"
pip install --upgrade pip >/dev/null
pip install -r "$REPO_ROOT/backend/requirements.txt"
deactivate

# --- Frontend build ---------------------------------------------------------
# Node is commonly installed via nvm, which only puts npm on PATH in shells that
# have sourced it. Source it here so running ./install.sh from a plain shell
# doesn't silently skip the build.
[ -z "${NVM_DIR:-}" ] && export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true

if command -v npm >/dev/null 2>&1; then
    log "Building frontend"
    ( cd "$REPO_ROOT/frontend" && npm install && npm run build )
else
    warn "npm not found (even after sourcing nvm) — SKIPPING frontend build."
    warn "The backend will only serve a dev placeholder until you build the UI:"
    warn "  export NVM_DIR=\"\$HOME/.nvm\"; . \"\$NVM_DIR/nvm.sh\"   # if using nvm"
    warn "  cd frontend && npm install && npm run build"
fi

# --- Privileged APT helper (Phase 6) ----------------------------------------
# HomeDeck runs unprivileged, but the APT app store needs root to install/remove
# packages. We install one small, root-owned helper and a scoped NOPASSWD
# sudoers rule that lets ONLY this user run ONLY that helper. The helper itself
# validates its input (see scripts/homedeck-apt). The app-level install password
# gates use of it from the UI.
APT_HELPER_DIR="/usr/local/lib/homedeck"
APT_HELPER_PATH="${APT_HELPER_DIR}/homedeck-apt"
SUDOERS_PATH="/etc/sudoers.d/homedeck-apt"

log "Installing privileged APT helper (sudo) -> ${APT_HELPER_PATH}"
sudo install -d -o root -g root -m 0755 "$APT_HELPER_DIR"
sudo install -o root -g root -m 0755 "$REPO_ROOT/scripts/homedeck-apt" "$APT_HELPER_PATH"

log "Installing sudoers rule (sudo) -> ${SUDOERS_PATH}"
SUDOERS_TMP="$(mktemp)"
printf '%s ALL=(root) NOPASSWD: %s\n' "$SERVICE_USER" "$APT_HELPER_PATH" > "$SUDOERS_TMP"
# Validate before installing so a typo can never break sudo.
if sudo visudo -cf "$SUDOERS_TMP" >/dev/null; then
    sudo install -o root -g root -m 0440 "$SUDOERS_TMP" "$SUDOERS_PATH"
else
    warn "Generated sudoers rule failed validation — skipping. APT install/remove will not work."
fi
rm -f "$SUDOERS_TMP"

# --- systemd unit -----------------------------------------------------------
VENV_PYTHON="${VENV_DIR}/bin/python"
RENDERED="$(mktemp)"
sed \
    -e "s|__USER__|${SERVICE_USER}|g" \
    -e "s|__REPO_ROOT__|${REPO_ROOT}|g" \
    -e "s|__VENV_PYTHON__|${VENV_PYTHON}|g" \
    "$REPO_ROOT/homedeck.service" > "$RENDERED"

log "Installing systemd unit (sudo) -> /etc/systemd/system/${SERVICE_NAME}.service"
sudo cp "$RENDERED" "/etc/systemd/system/${SERVICE_NAME}.service"
rm -f "$RENDERED"
sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}.service"

log "Done. Service status:"
sudo systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
log "Logs: sudo journalctl -u ${SERVICE_NAME} -f"
