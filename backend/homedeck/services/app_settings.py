"""Tiny key-value settings store backed by the ``app_settings`` table.

Generic on purpose: the install-password hash lives here now, and the planned
Settings page will reuse it for catalog sources, toggles, etc.
"""

from __future__ import annotations

from ..db import session_scope
from ..models import AppSetting, utcnow


def get_setting(key: str) -> str | None:
    with session_scope() as db:
        row = db.get(AppSetting, key)
        return row.value if row else None


def set_setting(key: str, value: str) -> None:
    with session_scope() as db:
        row = db.get(AppSetting, key)
        if row is None:
            row = AppSetting(key=key, value=value)
        else:
            row.value = value
            row.updated_at = utcnow()
        db.add(row)
        db.commit()


def delete_setting(key: str) -> None:
    with session_scope() as db:
        row = db.get(AppSetting, key)
        if row:
            db.delete(row)
            db.commit()
