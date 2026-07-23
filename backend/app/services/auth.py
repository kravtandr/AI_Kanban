import time
from collections import defaultdict
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ApiToken, SessionToken, TokenKind, User, utcnow
from app.security import generate_token, hash_password, hash_token, verify_password


class AuthError(Exception):
    pass


class RateLimited(AuthError):
    pass


# In-memory login rate limiter: ip -> list of attempt timestamps.
_attempts: dict[str, list[float]] = defaultdict(list)


def check_rate_limit(ip: str) -> None:
    settings = get_settings()
    now = time.monotonic()
    window = settings.login_rate_limit_window_seconds
    _attempts[ip] = [t for t in _attempts[ip] if now - t < window]
    if len(_attempts[ip]) >= settings.login_rate_limit_attempts:
        raise RateLimited("Too many login attempts, try again later")


def record_attempt(ip: str) -> None:
    _attempts[ip].append(time.monotonic())


def reset_rate_limiter() -> None:
    _attempts.clear()


def login(db: Session, username: str, password: str, ip: str) -> tuple[User, str]:
    check_rate_limit(ip)
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not verify_password(password, user.password_hash):
        record_attempt(ip)
        raise AuthError("Invalid username or password")
    token = generate_token()
    session = SessionToken(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=utcnow() + timedelta(days=get_settings().session_ttl_days),
    )
    db.add(session)
    db.commit()
    return user, token


def logout(db: Session, token: str) -> None:
    session = db.scalar(select(SessionToken).where(SessionToken.token_hash == hash_token(token)))
    if session is not None:
        db.delete(session)
        db.commit()


def user_by_session(db: Session, token: str) -> User | None:
    session = db.scalar(select(SessionToken).where(SessionToken.token_hash == hash_token(token)))
    if session is None or session.expires_at < utcnow():
        return None
    return session.user


def verify_api_token(db: Session, token: str, kind: TokenKind) -> bool:
    row = db.scalar(
        select(ApiToken).where(
            ApiToken.token_hash == hash_token(token),
            ApiToken.kind == kind,
            ApiToken.revoked_at.is_(None),
        )
    )
    if row is None:
        return False
    row.last_used_at = utcnow()
    db.commit()
    return True


def create_user(db: Session, username: str, password: str) -> User:
    if db.scalar(select(User).where(User.username == username)):
        raise AuthError(f"User '{username}' already exists")
    user = User(username=username, password_hash=hash_password(password))
    db.add(user)
    db.commit()
    return user


def create_api_token(db: Session, name: str, kind: TokenKind) -> str:
    token = generate_token()
    db.add(ApiToken(name=name, token_hash=hash_token(token), kind=kind))
    db.commit()
    return token
