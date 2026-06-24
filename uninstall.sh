#!/usr/bin/env bash
#
# HomeDeck uninstaller — reverses everything install.sh sets up.
#
# By default it removes the HomeDeck *installation* (systemd service, the
# privileged APT helper + sudoers rule, the Python venv, and build artifacts)
# but KEEPS your data and config (the SQLite DB, deployed-app compose files,
# config.yaml, .env) and leaves any apps HomeDeck deployed running.
#
# Use --purge to also delete the data + config and tear down HomeDeck-deployed
# Docker apps — i.e. remove absolutely everything.
#
#   ./uninstall.sh            # remove HomeDeck, keep data + deployed apps
#   ./uninstall.sh --purge    # also delete data/config + remove deployed apps
#   ./uninstall.sh --purge -y # ...without the confirmation prompt
#
# Run as the same normal user that ran install.sh. Privileged steps use sudo and
# will prompt for your password. This script never deletes the source checkout
# itself — remove the cloned folder by hand when you're done.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${REPO_ROOT}/.venv"
SERVICE_NAME="homedeck"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
APT_HELPER_DIR="/usr/local/lib/homedeck"
APT_HELPER_PATH="${APT_HELPER_DIR}/homedeck-apt"
SUDOERS_PATH="/etc/sudoers.d/homedeck-apt"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# --- Args -------------------------------------------------------------------
PURGE=0
ASSUME_YES=0
for arg in "$@"; do
    case "$arg" in
        --purge) PURGE=1 ;;
        -y|--yes) ASSUME_YES=1 ;;
        -h|--help)
            sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) die "Unknown option: $arg (try --help)" ;;
    esac
done

[ "$(id -u)" -eq 0 ] && die "Run this as your normal user, not root (sudo is used only where needed)."

# --- Plan + confirm ---------------------------------------------------------
echo "This will remove HomeDeck:"
echo "  • systemd service        $SERVICE_PATH"
echo "  • APT helper             $APT_HELPER_PATH (+ $APT_HELPER_DIR if empty)"
echo "  • sudoers rule           $SUDOERS_PATH"
echo "  • Python venv            $VENV_DIR"
echo "  • frontend build         frontend/dist, frontend/node_modules"
if [ "$PURGE" -eq 1 ]; then
    echo "  • PURGE — tear down HomeDeck-deployed apps (docker compose down)"
    echo "  • PURGE — delete data/ (SQLite DB, deployed-app files) + config.yaml + .env"
else
    echo "  • KEEP  data/ (DB, deployed-app files), config.yaml, .env"
    echo "  • KEEP  apps HomeDeck deployed (left running). Use --purge to remove them too."
fi
echo

if [ "$ASSUME_YES" -ne 1 ]; then
    printf 'Proceed? [y/N] '
    read -r reply
    case "$reply" in
        y|Y|yes|YES) ;;
        *) die "Aborted." ;;
    esac
fi

# --- systemd service --------------------------------------------------------
if [ -f "$SERVICE_PATH" ] || systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
    log "Stopping + disabling systemd service (sudo)"
    sudo systemctl disable --now "${SERVICE_NAME}.service" 2>/dev/null || warn "service was not running/enabled"
    sudo rm -f "$SERVICE_PATH"
    sudo systemctl daemon-reload
    sudo systemctl reset-failed "${SERVICE_NAME}.service" 2>/dev/null || true
else
    warn "No systemd unit found — skipping (dev install?)."
fi

# --- Privileged APT helper + sudoers ----------------------------------------
if [ -e "$SUDOERS_PATH" ] || [ -e "$APT_HELPER_PATH" ]; then
    log "Removing APT helper + sudoers rule (sudo)"
    sudo rm -f "$SUDOERS_PATH"
    sudo rm -f "$APT_HELPER_PATH"
    sudo rmdir "$APT_HELPER_DIR" 2>/dev/null || true  # only if now empty
else
    warn "No APT helper/sudoers found — skipping."
fi

# --- Local build artifacts (always safe to remove; regenerable) -------------
log "Removing venv + frontend build artifacts"
rm -rf "$VENV_DIR" "$REPO_ROOT/frontend/dist" "$REPO_ROOT/frontend/node_modules"

# --- Purge: deployed apps + data + config -----------------------------------
if [ "$PURGE" -eq 1 ]; then
    APPS_DIR="$REPO_ROOT/data/apps"
    if [ -d "$APPS_DIR" ] && command -v docker >/dev/null 2>&1; then
        log "Tearing down HomeDeck-deployed apps"
        for dir in "$APPS_DIR"/*/; do
            [ -d "$dir" ] || continue
            name="$(basename "$dir")"
            ( cd "$dir" && docker compose -p "$name" down ) \
                || warn "could not 'docker compose down' app '$name' (continuing)"
        done
    fi
    log "Deleting data/ + config.yaml + .env"
    rm -rf "$REPO_ROOT/data"
    rm -f "$REPO_ROOT/config.yaml" "$REPO_ROOT/.env"
fi

log "HomeDeck uninstalled."
if [ "$PURGE" -ne 1 ]; then
    echo "Kept your data/config. Re-run with --purge to remove those and any deployed apps."
fi
echo "The source folder is left in place — delete it by hand if you no longer need it:"
echo "  rm -rf \"$REPO_ROOT\""
