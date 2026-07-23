from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.schemas import DraftIn, DraftOut
from app.services import ai as ai_svc
from app.services import projects as project_svc
from app.services import tasks as task_svc

router = APIRouter(prefix="/ai", tags=["ai"], dependencies=[Depends(get_current_user)])


@router.post("/draft", response_model=DraftOut)
def draft(body: DraftIn, db: Session = Depends(get_db)):
    result = ai_svc.draft_task(db, body.text)
    return DraftOut(
        draft=result.draft,
        project_id=ai_svc.resolve_project_id(
            db, result.draft.project, result.draft.project_description
        ),
        ai_ok=result.ok,
        ai_error=result.error,
    )


@router.post("/enhance/{task_id}", response_model=DraftOut)
def enhance(task_id: int, db: Session = Depends(get_db)):
    try:
        task = task_svc.get_task(db, task_id)
    except task_svc.TaskError as exc:
        raise HTTPException(
            status_code=404, detail={"code": "not_found", "message": str(exc)}
        ) from exc
    result = ai_svc.enhance_task(db, task)
    # FR-5.3: enhance is a preview — it must not touch the DB. Map the suggested
    # project onto an existing one; anything unknown keeps the task's project.
    # Projects are only created (and descriptions backfilled) on /ai/draft.
    project_id = task.project_id
    if result.ok and result.draft.project:
        existing = project_svc.find_project_by_name(db, result.draft.project.strip()[:100])
        if existing is not None:
            project_id = existing.id
    return DraftOut(
        draft=result.draft,
        project_id=project_id,
        ai_ok=result.ok,
        ai_error=result.error,
    )
