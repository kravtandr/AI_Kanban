from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.models import User
from app.schemas import BudgetIn
from app.services import budget as svc

router = APIRouter(prefix="/budget", tags=["budget"])

Month = Annotated[str, Path(pattern=r"^[1-9][0-9]{3}-(0[1-9]|1[0-2])$")]


@router.get("/{month}")
def get_budget(
    month: Month,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BudgetIn:
    response.headers["Cache-Control"] = "no-store"
    return svc.get_budget(db, user.id, month)


@router.put("/{month}")
def put_budget(
    month: Month,
    body: BudgetIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BudgetIn:
    return svc.save_budget(db, user.id, month, body)
