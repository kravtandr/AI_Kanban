from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.models import MonthlyBudget, User

router = APIRouter(prefix="/budget", tags=["budget"])

Month = Annotated[str, Path(pattern=r"^[1-9][0-9]{3}-(0[1-9]|1[0-2])$")]
MAX_AMOUNT = 10_000_000_000  # 100 млн рублей в копейках


class FreelanceReceipt(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(default="", max_length=200)
    amount: int = Field(strict=True, gt=0, le=MAX_AMOUNT)


class BudgetIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    salary: int = Field(strict=True, ge=0, le=MAX_AMOUNT)
    freelance: list[FreelanceReceipt] = Field(max_length=100)


@router.get("/{month}")
def get_budget(
    month: Month,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BudgetIn:
    response.headers["Cache-Control"] = "no-store"
    row = db.get(MonthlyBudget, (user.id, month))
    return BudgetIn.model_validate(row) if row is not None else BudgetIn(salary=0, freelance=[])


@router.put("/{month}")
def put_budget(
    month: Month,
    body: BudgetIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BudgetIn:
    # Одним запросом создаём или заменяем месяц. Повтор PUT не дублирует заказы.
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
    values = body.model_dump()
    stmt = insert(MonthlyBudget).values(user_id=user.id, month=month, **values)
    db.execute(stmt.on_conflict_do_update(index_elements=["user_id", "month"], set_=values))
    db.commit()
    return body
