"""SQLite engine + session management via SQLModel."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

_settings = get_settings()

# check_same_thread=False so the engine can be shared across FastAPI's threadpool.
engine = create_engine(
    _settings.db_url,
    echo=False,
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    """Create tables and ensure the data directory exists."""
    _settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    # Import models so they register on SQLModel.metadata before create_all.
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: yields a DB session."""
    with Session(engine) as session:
        yield session


@contextmanager
def session_scope() -> Iterator[Session]:
    """Context manager for use outside request handlers."""
    with Session(engine) as session:
        yield session
