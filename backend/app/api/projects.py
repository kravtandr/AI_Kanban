from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.schemas import ProjectIn, ProjectOut, ProjectPatch
from app.services import projects as svc

router = APIRouter(prefix="/projects", tags=["projects"], dependencies=[Depends(get_current_user)])


def _out(project, count: int) -> ProjectOut:
    out = ProjectOut.model_validate(project)
    out.active_tasks = count
    return out


@router.get("", response_model=list[ProjectOut])
def list_projects(include_archived: bool = False, db: Session = Depends(get_db)):
    return [_out(p, c) for p, c in svc.list_projects(db, include_archived)]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    try:
        return _out(svc.create_project(db, body.name, body.color, body.description), 0)
    except svc.ProjectError as exc:
        raise HTTPException(
            status_code=409, detail={"code": "conflict", "message": str(exc)}
        ) from exc


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, body: ProjectPatch, db: Session = Depends(get_db)):
    try:
        project = svc.update_project(
            db,
            project_id,
            name=body.name,
            color=body.color,
            description=body.description,
            archived=body.archived,
        )
    except svc.ProjectError as exc:
        raise HTTPException(
            status_code=400, detail={"code": "bad_request", "message": str(exc)}
        ) from exc
    counts = {p.id: c for p, c in svc.list_projects(db, include_archived=True)}
    return _out(project, counts.get(project.id, 0))


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, force: bool = False, db: Session = Depends(get_db)):
    try:
        svc.delete_project(db, project_id, force)
    except svc.ProjectError as exc:
        raise HTTPException(
            status_code=400, detail={"code": "bad_request", "message": str(exc)}
        ) from exc
