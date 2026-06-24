"""Password hashing (Argon2) and server-side session helpers.

Sessions are opaque random tokens stored in SQLite (table ``auth_sessions``) and
referenced by an HttpOnly cookie. This allows server-side revocation (logout) and
avoids storing any signing secret on disk.
"""

from __future__ import annotations

import asyncio
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Cookie, Depends, HTTPException, Response, WebSocket, status
from sqlmodel import Session, select

from .config import get_settings
from .db import get_session, session_scope
from .models import AuthSession, User, utcnow

_ph = PasswordHasher()
_settings = get_settings()


# --- Password hashing -------------------------------------------------------

def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _ph.check_needs_rehash(password_hash)


# --- Sessions ---------------------------------------------------------------

def create_session(db: Session, user: User) -> AuthSession:
    token = secrets.token_urlsafe(32)
    expires = utcnow() + timedelta(hours=_settings.session.lifetime_hours)
    sess = AuthSession(token=token, user_id=user.id, expires_at=expires)
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return sess


def delete_session(db: Session, token: str) -> None:
    sess = db.get(AuthSession, token)
    if sess:
        db.delete(sess)
        db.commit()


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=_settings.session.cookie_name,
        value=token,
        httponly=True,
        samesite="lax",
        secure=_settings.server.https.enabled,
        max_age=_settings.session.lifetime_hours * 3600,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=_settings.session.cookie_name, path="/")


# --- FastAPI dependencies ---------------------------------------------------

def get_user_from_token(db: Session, token: str | None) -> User | None:
    """Resolve a user from a session token, or None. Expired sessions are pruned.

    Shared by the HTTP dependency and WebSocket auth (which can't use Depends).
    """
    if not token:
        return None
    sess = db.get(AuthSession, token)
    if sess is None:
        return None

    # expires_at is stored via UTCDateTime, so it comes back tz-aware UTC.
    if sess.expires_at < utcnow():
        db.delete(sess)
        db.commit()
        return None

    return db.get(User, sess.user_id)


def get_current_user(
    homedeck_session: str | None = Cookie(default=None, alias=_settings.session.cookie_name),
    db: Session = Depends(get_session),
) -> User:
    """Resolve the authenticated user from the session cookie, or 401."""
    user = get_user_from_token(db, homedeck_session)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


def admin_exists(db: Session) -> bool:
    return db.exec(select(User).limit(1)).first() is not None


async def authenticate_websocket(websocket: WebSocket) -> User | None:
    """Authenticate a WebSocket from the session cookie.

    WebSocket routes can't use the ``Depends`` cookie machinery, so this resolves
    the user off the event loop and returns a detached copy (the DB session is
    closed before we return). Shared by all ``ws/*`` endpoints.
    """
    token = websocket.cookies.get(_settings.session.cookie_name)

    def _lookup() -> User | None:
        with session_scope() as db:
            user = get_user_from_token(db, token)
            if user is None:
                return None
            return User(id=user.id, username=user.username, is_admin=user.is_admin)

    return await asyncio.to_thread(_lookup)
