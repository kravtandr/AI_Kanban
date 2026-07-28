import anyio
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.config import get_settings
from app.db import get_db
from app.schemas import DraftIn, DraftOut, TranscriptionOut
from app.services import ai as ai_svc
from app.services import projects as project_svc
from app.services import stt as stt_svc
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


# Read the upload in chunks: Content-Length is client-controlled and must not be
# trusted as a size guard. Note this bounds only what we copy into memory and
# forward to Whisper — by the time this handler runs, FastAPI has already
# fully parsed and spooled the multipart body (Starlette's
# SpooledTemporaryFile, threshold 1 MB) during dependency resolution. This
# loop does not protect the server from oversized uploads; it only limits
# what gets sent upstream.
_CHUNK_BYTES = 64 * 1024


@router.post("/transcribe", response_model=TranscriptionOut)
async def transcribe(file: UploadFile = File(...)):
    settings = get_settings()
    if not stt_svc.stt_configured(settings):
        raise HTTPException(
            status_code=503,
            detail={"code": "stt_disabled", "message": "Распознавание речи не настроено"},
        )

    limit = int(settings.whisper_max_audio_mb * 1024 * 1024)
    audio = bytearray()
    while chunk := await file.read(_CHUNK_BYTES):
        audio.extend(chunk)
        if len(audio) > limit:
            raise HTTPException(
                status_code=413,
                detail={"code": "audio_too_large", "message": "Запись слишком длинная"},
            )

    try:
        # The upstream call is synchronous httpx; keep it off the event loop.
        text = await anyio.to_thread.run_sync(
            stt_svc.transcribe,
            bytes(audio),
            file.filename or "audio.webm",
            file.content_type or "application/octet-stream",
        )
    except stt_svc.SttError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": "stt_upstream", "message": "Сервис распознавания недоступен"},
        ) from exc

    return TranscriptionOut(text=text)
