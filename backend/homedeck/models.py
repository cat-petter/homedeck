"""SQLModel table definitions.

Phase 1 covers users + sessions. Later phases extend this module (service health
config, app catalog, installed-app state, metrics history).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Column, DateTime, TypeDecorator
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """A DateTime that always round-trips as timezone-aware UTC.

    SQLite stores naive datetimes, so values read back lose their tzinfo. This
    normalizes to UTC on write and re-attaches UTC on read, so callers never have
    to patch naive datetimes by hand.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, _dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(self, value: datetime | None, _dialect: Any) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    # Argon2 PHC-format hash string. Never the plaintext password.
    password_hash: str
    is_admin: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utcnow, sa_type=UTCDateTime)


class AuthSession(SQLModel, table=True):
    __tablename__ = "auth_sessions"

    # Opaque random token stored in the session cookie.
    token: str = Field(primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utcnow, sa_type=UTCDateTime)
    expires_at: datetime = Field(sa_type=UTCDateTime)


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
    created_at: datetime = Field(default_factory=utcnow, sa_type=UTCDateTime)

    # Latest check result, updated by the engine (cheap reads, survives restart).
    last_status: str = Field(default="unknown")  # unknown | up | degraded | down
    last_checked_at: datetime | None = Field(default=None, sa_type=UTCDateTime)
    last_response_ms: float | None = Field(default=None)
    last_error: str | None = Field(default=None)


class ServiceCheckResult(SQLModel, table=True):
    """History of health-check outcomes (for uptime % and latency charts)."""

    __tablename__ = "service_check_results"

    id: int | None = Field(default=None, primary_key=True)
    service_id: int = Field(foreign_key="services.id", index=True)
    ts: datetime = Field(default_factory=utcnow, index=True, sa_type=UTCDateTime)
    status: str  # up | degraded | down
    response_ms: float | None = None
    error: str | None = None


class CatalogTemplate(SQLModel, table=True):
    """A normalized installable-app template imported from a public catalog.

    One internal schema for all sources; `spec` holds the normalized
    ports/env/volumes/etc. `image_key` (registry/repo, tag stripped) is the
    dedup key used by the normalization pipeline.
    """

    __tablename__ = "catalog_templates"

    id: str = Field(primary_key=True)  # e.g. "portainer:adguard"
    source: str = Field(index=True)  # portainer | casaos
    source_url: str = Field(default="")
    name: str = Field(index=True)
    description: str = Field(default="")
    logo: str = Field(default="")
    image: str = Field(default="")
    image_key: str = Field(default="", index=True)
    # Slug of the app name; templates sharing an app_group with different
    # image_keys are variants (official vs linuxserver, etc.).
    app_group: str = Field(default="", index=True)
    kind: str = Field(default="container")  # container | stack
    categories: list = Field(default_factory=list, sa_column=Column(JSON))
    spec: dict = Field(default_factory=dict, sa_column=Column(JSON))
    sources: list = Field(default_factory=list, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utcnow, sa_type=UTCDateTime)


class InstalledApp(SQLModel, table=True):
    """A Docker app deployed by HomeDeck from the app store.

    Each app is a single-service compose project written to ``data/apps/<name>/``
    and brought up with ``docker compose``. ``config`` keeps the full install
    config so the app can be reconfigured (re-rendered + recreated) later.
    """

    __tablename__ = "installed_apps"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)  # compose project + container name (slug)
    title: str = Field(default="")
    image: str = Field(default="")
    icon: str = Field(default="")
    web_ui_lan: str = Field(default="")
    web_ui_tailscale: str = Field(default="")
    template_id: str = Field(default="")  # provenance: catalog template it came from
    compose_dir: str = Field(default="")  # directory holding docker-compose.yml
    compose_yaml: str = Field(default="")
    config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    # Linked quick-launch tile (services.id), auto-created when a Web UI is set.
    service_id: int | None = Field(default=None)
    status: str = Field(default="unknown")  # running | stopped | error | unknown
    last_error: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow, sa_type=UTCDateTime)
    updated_at: datetime = Field(default_factory=utcnow, sa_type=UTCDateTime)


class AppSetting(SQLModel, table=True):
    """Generic key-value store for app-level settings/secrets.

    Used now for the APT install-password hash; the planned Settings page will
    use it for catalog sources, toggles, etc.
    """

    __tablename__ = "app_settings"

    key: str = Field(primary_key=True)
    value: str = Field(default="")
    updated_at: datetime = Field(default_factory=utcnow, sa_type=UTCDateTime)


class MetricSample(SQLModel, table=True):
    """A periodic host-metrics snapshot for the ~24h history charts."""

    __tablename__ = "metric_samples"

    id: int | None = Field(default=None, primary_key=True)
    ts: datetime = Field(default_factory=utcnow, index=True, sa_type=UTCDateTime)
    cpu_pct: float
    mem_pct: float
    mem_used: int
    mem_total: int
    swap_pct: float
    # Instantaneous network throughput in bytes/sec at sample time.
    net_rx_rate: float
    net_tx_rate: float
    load1: float
