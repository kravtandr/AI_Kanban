"""Measured effort statistics for the whole board (§10.1).

Not mounted under /tasks — that would shadow /tasks/{task_id} and depend on
declaration order. Not under /ai — this path needs no LLM and must not look like
it does.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.schemas import AnalyticsOut
from app.services import analytics as analytics_svc

router = APIRouter(
    prefix="/analytics", tags=["analytics"], dependencies=[Depends(get_current_user)]
)


@router.get("", response_model=AnalyticsOut)
def get_analytics(days: int = Query(30, ge=1, le=3650), db: Session = Depends(get_db)):
    return analytics_svc.compute(db, days=days)
