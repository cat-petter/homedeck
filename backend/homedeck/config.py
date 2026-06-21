"""Configuration loading: config.yaml + environment overrides.

Precedence (low -> high): built-in defaults -> config.yaml -> environment.
Environment overrides use the prefix ``HOMEDECK_`` with ``__`` as the nesting
delimiter, e.g. ``HOMEDECK_SERVER__PORT=9000`` overrides ``server.port``.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)

# Project root = repo root (two levels up from this file: backend/homedeck/config.py)
BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent


def _config_file_path() -> Path:
    candidate = os.environ.get("HOMEDECK_CONFIG_FILE")
    return Path(candidate) if candidate else (REPO_ROOT / "config.yaml")


class HttpsConfig(BaseModel):
    enabled: bool = False
    cert_file: str = ""
    key_file: str = ""


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    # 8770 by default to avoid the common 8080 (often already taken on a homelab).
    port: int = 8770
    https: HttpsConfig = Field(default_factory=HttpsConfig)


class DatabaseConfig(BaseModel):
    # Relative paths are resolved against the repo root.
    path: str = "data/homedeck.db"


class DockerConfig(BaseModel):
    socket: str = "unix:///var/run/docker.sock"


class SessionConfig(BaseModel):
    cookie_name: str = "homedeck_session"
    lifetime_hours: int = 24 * 14


class Settings(BaseSettings):
    """Top-level settings, assembled from defaults -> yaml -> environment."""

    model_config = SettingsConfigDict(
        env_prefix="HOMEDECK_",
        env_nested_delimiter="__",
        extra="ignore",
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        yaml_file=None,  # set dynamically in get_settings()
        yaml_file_encoding="utf-8",
    )

    server: ServerConfig = Field(default_factory=ServerConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    docker: DockerConfig = Field(default_factory=DockerConfig)
    session: SessionConfig = Field(default_factory=SessionConfig)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # Order = priority, highest first. env > yaml > defaults.
        return (
            init_settings,
            env_settings,
            dotenv_settings,
            YamlConfigSettingsSource(settings_cls),
            file_secret_settings,
        )

    @property
    def db_path(self) -> Path:
        p = Path(self.database.path)
        return p if p.is_absolute() else (REPO_ROOT / p)

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings (defaults <- config.yaml <- environment)."""
    cfg = _config_file_path()
    # Point the yaml source at the resolved path only if it exists.
    Settings.model_config["yaml_file"] = str(cfg) if cfg.is_file() else None
    return Settings()
