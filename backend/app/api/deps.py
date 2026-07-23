from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import TokenKind, User
from app.services.auth import user_by_session, verify_api_token

SESSION_COOKIE = "tt_session"


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        user = user_by_session(db, token)
        if user is not None:
            return user
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and verify_api_token(db, auth[7:], TokenKind.api):
        # API-token access acts as the (single) tracker owner.
        owner = db.query(User).first()
        if owner is not None:
            return owner
    raise HTTPException(
        status_code=401, detail={"code": "unauthorized", "message": "Login required"}
    )
