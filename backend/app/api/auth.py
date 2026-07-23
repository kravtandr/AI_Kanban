from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import SESSION_COOKIE, get_current_user
from app.config import get_settings
from app.db import get_db
from app.models import User
from app.schemas import LoginIn, UserOut
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    try:
        user, token = auth_service.login(db, body.username, body.password, ip)
    except auth_service.RateLimited as exc:
        raise HTTPException(
            status_code=429, detail={"code": "rate_limited", "message": str(exc)}
        ) from exc
    except auth_service.AuthError as exc:
        raise HTTPException(
            status_code=401, detail={"code": "bad_credentials", "message": str(exc)}
        ) from exc
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.app_env == "prod",
        path="/",
    )
    return user


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        auth_service.logout(db, token)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
