"""App-level 'install password' for privileged package operations.

A dedicated secret (separate from the login password) required before APT
install/remove/upgrade. Stored as an Argon2 hash in the key-value settings
store. This is an APP-layer gate: it blocks an unauthorized/hijacked HomeDeck
session from running package ops, but is not an OS-level control (the sudoers
helper is NOPASSWD so the service can invoke it non-interactively). See the
Phase 6 privilege-model decision.
"""

from __future__ import annotations

from ..security import hash_password, verify_password
from . import app_settings

_KEY = "apt_install_password_hash"
_MIN_LEN = 6


class InstallAuthError(RuntimeError):
    pass


def is_set() -> bool:
    return bool(app_settings.get_setting(_KEY))


def set_password(new_password: str, current_password: str | None = None) -> None:
    """Set the install password (first time) or change it (requires current)."""
    new_password = new_password or ""
    if len(new_password) < _MIN_LEN:
        raise InstallAuthError(f"Install password must be at least {_MIN_LEN} characters.")
    existing = app_settings.get_setting(_KEY)
    if existing:
        # Changing an existing password requires the current one.
        if not current_password or not verify_password(existing, current_password):
            raise InstallAuthError("Current install password is incorrect.")
    app_settings.set_setting(_KEY, hash_password(new_password))


def verify(password: str) -> bool:
    h = app_settings.get_setting(_KEY)
    if not h:
        return False
    return verify_password(h, password or "")


def require(password: str) -> None:
    """Raise InstallAuthError unless the install password is set and correct."""
    if not is_set():
        raise InstallAuthError("No install password is set. Set one before installing packages.")
    if not verify(password):
        raise InstallAuthError("Install password is incorrect.")
