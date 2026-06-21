"""SQLModel table definitions.

Phase 1 covers users + sessions. Later phases extend this module (service health
config, app catalog, installed-app state, metrics history).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    # Argon2 PHC-format hash string. Never the plaintext password.
    password_hash: str
    is_admin: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utcnow)


class AuthSession(SQLModel, table=True):
    __tablename__ = "auth_sessions"

    # Opaque random token stored in the session cookie.
    token: str = Field(primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime


class MetricSample(SQLModel, table=True):
    """A periodic host-metrics snapshot for the ~24h history charts."""

    __tablename__ = "metric_samples"

    id: int | None = Field(default=None, primary_key=True)
    ts: datetime = Field(default_factory=utcnow, index=True)
    cpu_pct: float
    mem_pct: float
    mem_used: int
    mem_total: int
    swap_pct: float
    # Instantaneous network throughput in bytes/sec at sample time.
    net_rx_rate: float
    net_tx_rate: float
    load1: float
