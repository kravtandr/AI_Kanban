import re

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models import MonthlyBudget
from app.schemas import BudgetIn


def validate_month(month: str) -> str:
    if not re.fullmatch(r"[1-9][0-9]{3}-(0[1-9]|1[0-2])", month):
        raise ValueError("month must be YYYY-MM between 1000-01 and 9999-12")
    return month


def get_budget(db: Session, user_id: int, month: str) -> BudgetIn:
    validate_month(month)
    row = db.get(MonthlyBudget, (user_id, month))
    return BudgetIn.model_validate(row) if row is not None else BudgetIn(salary=0, freelance=[])


def save_budget(db: Session, user_id: int, month: str, body: BudgetIn) -> BudgetIn:
    validate_month(month)
    # Atomic replacement keeps retries idempotent, as in the original REST endpoint.
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
    values = body.model_dump()
    stmt = insert(MonthlyBudget).values(user_id=user_id, month=month, **values)
    db.execute(stmt.on_conflict_do_update(index_elements=["user_id", "month"], set_=values))
    db.commit()
    return body
