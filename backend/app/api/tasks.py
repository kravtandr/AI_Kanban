from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.models import TaskPriority, TaskStatus
from app.schemas import MoveIn, TaskIn, TaskOut, TaskPatch
from app.services import tasks as svc

router = APIRouter(prefix="/tasks", tags=["tasks"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[TaskOut])
def list_tasks(
    project_id: list[int] | None = Query(default=None),
    status: TaskStatus | None = None,
    priority: TaskPriority | None = None,
    tag: str | None = None,
    q: str | None = None,
    all_done: bool = False,
    db: Session = Depends(get_db),
):
    return svc.list_tasks(
        db,
        project_ids=project_id,
        status=status,
        priority=priority,
        tag=tag,
        query=q,
        all_done=all_done,
    )


@router.post("", response_model=TaskOut, status_code=201)
def create_task(body: TaskIn, db: Session = Depends(get_db)):
    try:
        return svc.create_task(db, **body.model_dump())
    except svc.TaskError as exc:
        raise HTTPException(
            status_code=400, detail={"code": "bad_request", "message": str(exc)}
        ) from exc


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db)):
    try:
        return svc.get_task(db, task_id)
    except svc.TaskError as exc:
        raise HTTPException(
            status_code=404, detail={"code": "not_found", "message": str(exc)}
        ) from exc


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, body: TaskPatch, db: Session = Depends(get_db)):
    try:
        return svc.update_task(db, task_id, **body.model_dump(exclude_unset=True))
    except svc.TaskError as exc:
        code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(
            status_code=code, detail={"code": "error", "message": str(exc)}
        ) from exc


@router.post("/{task_id}/move", response_model=TaskOut)
def move_task(task_id: int, body: MoveIn, db: Session = Depends(get_db)):
    try:
        return svc.move_task(db, task_id, body.status, body.sort_order)
    except svc.TaskError as exc:
        raise HTTPException(
            status_code=404, detail={"code": "not_found", "message": str(exc)}
        ) from exc


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    try:
        svc.delete_task(db, task_id)
    except svc.TaskError as exc:
        raise HTTPException(
            status_code=404, detail={"code": "not_found", "message": str(exc)}
        ) from exc
