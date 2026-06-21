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


class Service(SQLModel, table=True):
    """A homelab service: a quick-launch tile that is optionally health-monitored.

    One entity powers both the quick-launch grid and the health page. Set
    ``check_type='none'`` for a launch-only tile with no monitoring.
    """

    __tablename__ = "services"

    id: int | None = Field(default=None, primary_key=True)
    name: str
    category: str = Field(default="")
    icon: str = Field(default="")  # emoji or short text
    lan_url: str = Field(default="")
    tailscale_url: str = Field(default="")

    # Health check config.
    check_type: str = Field(default="none")  # none | http | tcp | ping
    check_target: str = Field(default="")  # http URL, "host:port" for tcp, host for ping
    expected_status: str = Field(default="")  # http: "200" or "200-399"; empty → 2xx/3xx
    interval_seconds: int = Field(default=60)
    timeout_seconds: int = Field(default=10)
    degraded_ms: int | None = Field(default=None)  # slow-but-up threshold
    verify_tls: bool = Field(default=False)
    enabled: bool = Field(default=True)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow)

    # Latest check result, updated by the engine (cheap reads, survives restart).
    last_status: str = Field(default="unknown")  # unknown | up | degraded | down
    last_checked_at: datetime | None = Field(default=None)
    last_response_ms: float | None = Field(default=None)
    last_error: str | None = Field(default=None)


class ServiceCheckResult(SQLModel, table=True):
    """History of health-check outcomes (for uptime % and latency charts)."""

    __tablename__ = "service_check_results"

    id: int | None = Field(default=None, primary_key=True)
    service_id: int = Field(foreign_key="services.id", index=True)
    ts: datetime = Field(default_factory=utcnow, index=True)
    status: str  # up | degraded | down
    response_ms: float | None = None
    error: str | None = None


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
