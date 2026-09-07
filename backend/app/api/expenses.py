from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.models import Expense, ExpenseStatus
from app.schemas import ExpenseIn, ExpenseMoveIn, ExpenseOut, ExpensePatch, ExpenseSummaryOut
from app.services import expenses as svc

router = APIRouter(prefix="/expenses", tags=["expenses"], dependencies=[Depends(get_current_user)])


def expense_out(e: Expense) -> ExpenseOut:
    return ExpenseOut.model_validate(e).model_copy(update={"next_charge": svc.next_charge_for(e)})


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail={"code": "bad_request", "message": str(exc)})


def _not_found(exc: Exception) -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "not_found", "message": str(exc)})


def _error(exc: svc.ExpenseError) -> HTTPException:
    return _not_found(exc) if "not found" in str(exc).lower() else _bad_request(exc)


@router.get("", response_model=list[ExpenseOut])
def list_expenses(
    status: ExpenseStatus | None = None,
    tag: str | None = None,
    q: str | None = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
):
    rows = svc.list_expenses(db, status=status, tag=tag, query=q, include_inactive=include_inactive)
    return [expense_out(e) for e in rows]


# ДО /{expense_id}: иначе FastAPI попробует разобрать "summary" как int (§7.3).
@router.get("/summary", response_model=ExpenseSummaryOut)
def summary(db: Session = Depends(get_db)):
    return svc.summary(db)


@router.post("", response_model=ExpenseOut, status_code=201)
def create_expense(body: ExpenseIn, db: Session = Depends(get_db)):
    try:
        e = svc.create_expense(db, **body.model_dump())
    except svc.ExpenseError as exc:
        raise _bad_request(exc) from exc
    return expense_out(e)


@router.get("/{expense_id}", response_model=ExpenseOut)
def get_expense(expense_id: int, db: Session = Depends(get_db)):
    try:
        return expense_out(svc.get_expense(db, expense_id))
    except svc.ExpenseError as exc:
        raise _not_found(exc) from exc


@router.patch("/{expense_id}", response_model=ExpenseOut)
def update_expense(expense_id: int, body: ExpensePatch, db: Session = Depends(get_db)):
    try:
        e = svc.update_expense(db, expense_id, **body.model_dump(exclude_unset=True))
    except svc.ExpenseError as exc:
        raise _error(exc) from exc
    return expense_out(e)


@router.post("/{expense_id}/move", response_model=ExpenseOut)
def move_expense(expense_id: int, body: ExpenseMoveIn, db: Session = Depends(get_db)):
    try:
        e = svc.move_expense(db, expense_id, body.status, body.sort_order)
    except svc.ExpenseError as exc:
        raise _error(exc) from exc
    return expense_out(e)


@router.delete("/{expense_id}", status_code=204)
def delete_expense(expense_id: int, db: Session = Depends(get_db)):
    try:
        svc.delete_expense(db, expense_id)
    except svc.ExpenseError as exc:
        raise _not_found(exc) from exc
