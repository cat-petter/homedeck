"""Auth + first-run setup wizard."""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..config import get_settings
from ..db import get_session
from ..models import User
from ..security import (
    admin_exists,
    clear_session_cookie,
    create_session,
    delete_session,
    get_current_user,
    hash_password,
    set_session_cookie,
    verify_password,
)

_COOKIE_NAME = get_settings().session.cookie_name

router = APIRouter(prefix="/api/auth", tags=["auth"])
setup_router = APIRouter(prefix="/api/setup", tags=["setup"])


# --- Schemas ----------------------------------------------------------------

class SetupStatus(BaseModel):
    needs_setup: bool


class SetupRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class UserOut(BaseModel):
    id: int
    username: str
    is_admin: bool


# --- Setup wizard -----------------------------------------------------------

@setup_router.get("/status", response_model=SetupStatus)
def setup_status(db: Session = Depends(get_session)) -> SetupStatus:
    return SetupStatus(needs_setup=not admin_exists(db))


@setup_router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_admin(
    payload: SetupRequest,
    response: Response,
    db: Session = Depends(get_session),
) -> UserOut:
    # Setup is only permitted while no user exists. Closes the wizard afterwards.
    if admin_exists(db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Setup already completed",
        )
    user = User(
        username=payload.username.strip(),
        password_hash=hash_password(payload.password),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Log the new admin straight in.
    sess = create_session(db, user)
    set_session_cookie(response, sess.token)
    return UserOut(id=user.id, username=user.username, is_admin=user.is_admin)


# --- Login / logout / me ----------------------------------------------------

@router.post("/login", response_model=UserOut)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_session),
) -> UserOut:
    user = db.exec(select(User).where(User.username == payload.username.strip())).first()
    # Constant-ish failure path: same error whether user missing or bad password.
    if user is None or not verify_password(user.password_hash, payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    sess = create_session(db, user)
    set_session_cookie(response, sess.token)
    return UserOut(id=user.id, username=user.username, is_admin=user.is_admin)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=_COOKIE_NAME),
    db: Session = Depends(get_session),
) -> Response:
    # Revoke the server-side session (if any) and clear the cookie regardless.
    if session_token:
        delete_session(db, session_token)
    clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(id=user.id, username=user.username, is_admin=user.is_admin)
