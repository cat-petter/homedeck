"""SQLite engine + session management via SQLModel."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

_settings = get_settings()

# check_same_thread=False so the engine can be shared across FastAPI's threadpool.
engine = create_engine(
    _settings.db_url,
    echo=False,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record) -> None:
    """Per-connection SQLite tuning for concurrent access.

    The background metrics/health loops write while request handlers read and
    occasionally write (e.g. deploying an app). WAL lets readers and a writer
    proceed concurrently; busy_timeout makes a second *writer* wait for the lock
    instead of immediately raising "database is locked".
    """
    if engine.dialect.name != "sqlite":
        return
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA busy_timeout=5000")  # ms — wait, don't crash, on lock
    cur.execute("PRAGMA synchronous=NORMAL")  # safe + fast under WAL
    cur.close()


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
