# Диктовка через self-hosted Whisper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить диктовку на Web Speech API записью через MediaRecorder с расшифровкой на собственном Whisper, проксируемом бэкендом, и включить HTTPS в LAN, без которого запись звука в браузере невозможна.

**Architecture:** Браузер пишет аудио через `MediaRecorder` и шлёт `multipart/form-data` на `POST /api/v1/ai/transcribe` собственного бэкенда; тот проксирует запрос на OpenAI-совместимый `/v1/audio/transcriptions` Whisper по адресу из env и возвращает текст. Прокси через свой бэкенд оставляет вызов same-origin (CSP `connect-src 'self'`), переиспользует сессионную куку для авторизации и не выносит адрес кластера в браузер. Secure context обеспечивает второй сайт Caddy с `tls internal`.

**Tech Stack:** FastAPI + Pydantic v2 + httpx (backend), React 18 + TypeScript + vitest + Testing Library (frontend), Caddy 2 (`tls internal`), docker compose.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-07-28-whisper-stt-design.md`. Расхождение с ней — повод остановиться и спросить, а не решить самому.
- Язык пользовательских строк в UI и сообщений об ошибках — русский, строчная стилистика существующих подсказок.
- Комментарии в коде — на языке окружающего файла: бэкенд по-английски, фронтенд по-русски.
- Тесты обязательны для нового и изменённого поведения (AGENTS.md). Сеть в тестах не используется — `httpx` и браузерные API мокаются.
- Ruff: `line-length = 100`, `target-version = "py312"`, правила `E, F, I, UP, B`.
- Гейты: `make lint`, `make test-fast`, `make test`, `make build`, `make verify`. Ненулевой код выхода — провал; ослаблять гейты запрещено, `--no-verify` запрещён.
- Деплой в этот план **не входит**. Ни одна задача не выполняет `docker compose up`, `ufw`, установку сертификатов и не трогает некоммитимый `docker-compose.override.yml`.
- Значения по умолчанию (копия из спеки, раздел 4.1): `WHISPER_BASE_URL` = пусто, `WHISPER_LANGUAGE` = `ru`, `WHISPER_TIMEOUT_SECONDS` = `60.0`, `WHISPER_MAX_AUDIO_MB` = `10.0`.
- Конфигурация владельца, попадающая только в `.env.example` как пример: `WHISPER_BASE_URL=http://host.docker.internal:30558`.
- Максимальная длина одной записи в UI: 120 секунд.
- Коды ошибок эндпоинта: `stt_disabled` (503), `audio_too_large` (413), `stt_upstream` (502).

---

### Task 1: ADR-0006 и ADR-0007

AGENTS.md требует ADR **до** реализации при смене протокола доступа и при новой внешней зависимости, задающей политику. Это два независимых решения, поэтому два документа. Тестов у задачи нет — это документы.

**Files:**
- Create: `docs/adr/0006-https-lan.md`
- Create: `docs/adr/0007-stt.md`

**Interfaces:**
- Consumes: ничего.
- Produces: номера ADR-0006 и ADR-0007, на которые ссылаются комментарии в коде задач 2, 3 и 7.

- [ ] **Step 1: Написать ADR-0006**

Создать `docs/adr/0006-https-lan.md`:

```markdown
# ADR-0006: HTTPS в локальной сети через `tls internal`

- **Статус**: accepted (утверждено владельцем 2026-07-28)
- **Дата**: 2026-07-28

## Контекст

ADR-0004 оставил открытым вопрос «HTTP в доверенной LAN vs `tls internal`». Голосовой
ввод (ADR-0007) закрывает его принудительно: `navigator.mediaDevices.getUserMedia`
доступен только в secure context — HTTPS либо localhost. На `http://<server>:27182`
объект `navigator.mediaDevices` отсутствует, поэтому запись звука с телефона
невозможна в принципе. То же ограничение действует и на Web Speech API, то есть
существующая кнопка микрофона на мобильном устройстве не работает уже сейчас.

## Решение

Caddy отдаёт второй сайт по HTTPS с сертификатом собственного CA (`tls internal`).
Адрес сайта задаётся переменной окружения `TT_HTTPS_ADDR`, чтобы host-специфичный
адрес не попадал в репозиторий. Доступ ограничен диапазонами LAN средствами Caddy
(`remote_ip`), повторяя ACL фронтящего nginx, поскольку HTTPS-путь идёт мимо него.

При включении HTTPS устанавливаются `COOKIE_SECURE=true` и `APP_ENV=prod`, как
предписывал ADR-0004. Существующий HTTP-вход сохраняется для MCP-агентов: они
авторизуются Bearer-токеном, сессионная кука им не нужна.

Корневой сертификат CA (`/data/caddy/pki/authorities/local/root.crt` в томе
`caddy_data`) устанавливается на устройства владельца. На iOS требуется установка
профиля и отдельное включение в Settings → General → About → Certificate Trust
Settings. Корневой сертификат действует годы — ротируется только промежуточный,
поэтому процедура разовая.

## Альтернативы

- **Tailscale** с настоящим сертификатом Let's Encrypt — снимает установку CA и даёт
  доступ вне дома, но добавляет демон на сервер и клиент на каждое устройство.
  Отклонено владельцем в пользу решения без новых зависимостей; остаётся открытой
  опцией, ADR-0004 её уже допускал.
- **Публичный домен с настоящим сертификатом** — отклонено ещё в ADR-0004: проброс
  портов наружу неоправдан для персонального сервиса.
- **Оставить HTTP** — означает отказ от голосового ввода на мобильных устройствах,
  то есть от цели работы.

## Последствия

- UI логинится только по HTTPS: с `COOKIE_SECURE=true` кука не будет установлена по
  HTTP. HTTP-порт остаётся рабочим для `/mcp`.
- Каждое новое устройство требует установки корневого сертификата, иначе браузер
  покажет предупреждение и заблокирует secure context.
- HSTS-заголовок при обращении по IP-адресу браузерами игнорируется; это не влияет на
  доступность secure context.
- ADR-0004 остаётся в силе: наружу по-прежнему не открыто ничего.
```

- [ ] **Step 2: Написать ADR-0007**

Создать `docs/adr/0007-stt.md`:

```markdown
# ADR-0007: Распознавание речи на self-hosted Whisper

- **Статус**: accepted (утверждено владельцем 2026-07-28)
- **Дата**: 2026-07-28

## Контекст

Диктовка задач была реализована на Web Speech API. У него три недостатка: аудио
уходит стороннему сервису (в Chrome — Google), API отсутствует в части браузеров
(Firefox), и качество распознавания русской речи владельца не устраивает. На том же
хосте уже работает собственный Whisper.

## Решение

Web Speech API удаляется полностью, распознавание идёт через self-hosted Whisper.

- API сервиса OpenAI-совместим: `POST /v1/audio/transcriptions`, `multipart/form-data`
  с полями `file`, `language`, `response_format`. Авторизации нет.
- Браузер **не обращается к сервису напрямую**. Аудио идёт через бэкенд трекера
  (`POST /api/v1/ai/transcribe`). Это оставляет вызов same-origin (CSP
  `connect-src 'self'` не ослабляется), даёт авторизацию по существующей сессионной
  куке и не требует ни CORS на Whisper, ни открытия его порта в LAN.
- Адрес задаётся переменной `WHISPER_BASE_URL`. Пустое значение — штатное состояние
  «STT выключен»: трекер обязан работать без распознавания так же, как он уже
  работает без LLM.
- Внутрикластерное имя `whisper-stt.ai-models.svc.cluster.local` неприменимо: трекер
  живёт в docker compose вне кластера и это имя не резолвит. Используется NodePort
  сервиса через `host.docker.internal` — тот же приём, что уже применён для LiteLLM.
- Аудио не сохраняется: оно живёт только в памяти обрабатывающего запрос потока.
- Учёт в таблице `llm_usage` не ведётся: у STT нет токенов.

## Альтернативы

- **Прямой вызов Whisper из браузера** — потребовал бы CORS на сервисе, открытия порта
  в ufw, ослабления CSP и не дал бы авторизации. Отклонено.
- **Whisper через LiteLLM** — LiteLLM проксирует audio-эндпоинты, но добавил бы второй
  сетевой хоп ради унификации, которой здесь нет пользы: у STT свой формат запроса.

## Последствия

- Голосовой ввод требует HTTPS (ADR-0006).
- Промежуточный транскрипт (interim results) исчезает: Whisper распознаёт целую
  запись, а не поток. Текст появляется одним куском после остановки записи.
- Недоступность Whisper деградирует штатно: UI объясняет причину, ввод с клавиатуры
  продолжает работать.
```

- [ ] **Step 3: Проверить нумерацию и ссылки**

Run: `ls docs/adr/`
Expected: файлы `0000-template.md` … `0007-stt.md`, номера без пропусков и дубликатов.

- [ ] **Step 4: Обновить список принятых ADR в AGENTS.md**

В `AGENTS.md`, в разделе «## ADR», заменить строку:

```
Принятые: 0001 adoption, 0002 стек, 0003 авторизация, 0004 сетевая модель, 0005 LLM.
```

на:

```
Принятые: 0001 adoption, 0002 стек, 0003 авторизация, 0004 сетевая модель, 0005 LLM,
0006 HTTPS в LAN, 0007 распознавание речи.
```

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0006-https-lan.md docs/adr/0007-stt.md AGENTS.md
git commit -m "docs(adr): HTTPS в LAN (0006) и self-hosted Whisper для STT (0007)"
```

---

### Task 2: Конфигурация и сервис STT

Сервисный слой без HTTP-обвязки: настройки плюс функция, умеющая сходить в Whisper и вернуть текст. Тестируется напрямую, без TestClient.

**Files:**
- Modify: `backend/app/config.py`
- Create: `backend/app/services/stt.py`
- Test: `backend/tests/test_stt.py`

**Interfaces:**
- Consumes: `app.config.Settings`, `app.config.get_settings` (существуют).
- Produces:
  - `Settings.whisper_base_url: str | None`, `Settings.whisper_language: str`, `Settings.whisper_timeout_seconds: float`, `Settings.whisper_max_audio_mb: float`
  - `app.services.stt.SttError(Exception)`
  - `app.services.stt.stt_configured(settings: Settings) -> bool`
  - `app.services.stt.transcribe(audio: bytes, filename: str, content_type: str) -> str`

- [ ] **Step 1: Написать падающие тесты сервиса**

Создать `backend/tests/test_stt.py`:

```python
"""STT service: proxy to a self-hosted Whisper (ADR-0007). Network is mocked."""

import httpx
import pytest

from app.config import get_settings
from app.services import stt as stt_svc


def _configure(monkeypatch, **overrides: str) -> None:
    monkeypatch.setenv("WHISPER_BASE_URL", overrides.get("base_url", "http://fake-whisper:30558"))
    monkeypatch.setenv("WHISPER_LANGUAGE", overrides.get("language", "ru"))
    get_settings.cache_clear()


def test_stt_configured_follows_base_url(monkeypatch):
    monkeypatch.setenv("WHISPER_BASE_URL", "")
    get_settings.cache_clear()
    assert stt_svc.stt_configured(get_settings()) is False

    _configure(monkeypatch)
    assert stt_svc.stt_configured(get_settings()) is True


def test_transcribe_posts_audio_and_returns_text(monkeypatch):
    _configure(monkeypatch)
    captured: dict = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["files"] = kwargs["files"]
        captured["data"] = kwargs["data"]
        captured["timeout"] = kwargs["timeout"]
        return httpx.Response(200, json={"text": "  купить молоко  "})

    monkeypatch.setattr(stt_svc.httpx, "post", fake_post)

    assert stt_svc.transcribe(b"audio-bytes", "audio.webm", "audio/webm") == "купить молоко"
    assert captured["url"] == "http://fake-whisper:30558/v1/audio/transcriptions"
    assert captured["files"] == {"file": ("audio.webm", b"audio-bytes", "audio/webm")}
    assert captured["data"] == {"language": "ru", "response_format": "json"}
    assert captured["timeout"] == 60.0


def test_transcribe_strips_trailing_slash_in_base_url(monkeypatch):
    _configure(monkeypatch, base_url="http://fake-whisper:30558/")
    captured: dict = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        return httpx.Response(200, json={"text": "ок"})

    monkeypatch.setattr(stt_svc.httpx, "post", fake_post)

    stt_svc.transcribe(b"a", "audio.webm", "audio/webm")
    assert captured["url"] == "http://fake-whisper:30558/v1/audio/transcriptions"


def test_transcribe_without_config_raises(monkeypatch):
    monkeypatch.setenv("WHISPER_BASE_URL", "")
    get_settings.cache_clear()
    with pytest.raises(stt_svc.SttError):
        stt_svc.transcribe(b"a", "audio.webm", "audio/webm")


def test_transcribe_maps_upstream_error_status(monkeypatch):
    _configure(monkeypatch)

    def fake_post(url, **kwargs):
        return httpx.Response(500, text="boom", request=httpx.Request("POST", url))

    monkeypatch.setattr(stt_svc.httpx, "post", fake_post)

    with pytest.raises(stt_svc.SttError):
        stt_svc.transcribe(b"a", "audio.webm", "audio/webm")


def test_transcribe_maps_transport_error(monkeypatch):
    _configure(monkeypatch)

    def fake_post(url, **kwargs):
        raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(stt_svc.httpx, "post", fake_post)

    with pytest.raises(stt_svc.SttError):
        stt_svc.transcribe(b"a", "audio.webm", "audio/webm")


def test_transcribe_rejects_reply_without_text_field(monkeypatch):
    _configure(monkeypatch)

    def fake_post(url, **kwargs):
        return httpx.Response(200, json={"unexpected": "shape"})

    monkeypatch.setattr(stt_svc.httpx, "post", fake_post)

    with pytest.raises(stt_svc.SttError):
        stt_svc.transcribe(b"a", "audio.webm", "audio/webm")


def test_transcribe_allows_empty_text(monkeypatch):
    """Silence is a valid outcome, not a failure."""
    _configure(monkeypatch)

    def fake_post(url, **kwargs):
        return httpx.Response(200, json={"text": ""})

    monkeypatch.setattr(stt_svc.httpx, "post", fake_post)

    assert stt_svc.transcribe(b"a", "audio.webm", "audio/webm") == ""
```

- [ ] **Step 2: Изолировать тесты от реального окружения**

В `backend/tests/conftest.py`, в блок очистки окружения (после строки `os.environ["MCP_TOKEN"] = ""`), добавить:

```python
os.environ["WHISPER_BASE_URL"] = ""
```

Комментарий над блоком уже объясняет цель («Make sure a developer's real keys/endpoints never leak into tests») — новая строка попадает под него.

- [ ] **Step 3: Запустить тесты и убедиться, что они падают**

Run: `cd backend && uv run pytest tests/test_stt.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.stt'`

- [ ] **Step 4: Добавить настройки в config.py**

В `backend/app/config.py`, после блока настроек LLM (сразу за строкой `openai_model: str = ""`) и перед комментарием про MCP-токен, вставить:

```python
    # Self-hosted Whisper for speech-to-text (ADR-0007). An empty base URL is the
    # normal "STT disabled" state: the tracker must work without it, exactly as it
    # already works without an LLM. Base URL without a trailing path, e.g.
    # http://host.docker.internal:30558
    whisper_base_url: str | None = None
    whisper_language: str = "ru"
    whisper_timeout_seconds: float = 60.0
    whisper_max_audio_mb: float = 10.0
```

- [ ] **Step 5: Написать сервис**

Создать `backend/app/services/stt.py`:

```python
"""Speech-to-text: proxy to a self-hosted Whisper (ADR-0007).

The browser never calls the STT service directly. Routing audio through this
backend keeps the request same-origin (CSP allows `connect-src 'self'` only),
reuses the session cookie for authorization, and keeps the service address on
the server side. The upstream API is OpenAI-compatible.

Audio is never written to disk: it lives only in the memory of the handling
request.
"""

import logging

import httpx

from app.config import Settings, get_settings

log = logging.getLogger(__name__)


class SttError(Exception):
    """The STT service is unreachable, failed, or answered in an unusable shape."""


def stt_configured(settings: Settings) -> bool:
    return bool(settings.whisper_base_url)


def transcribe(audio: bytes, filename: str, content_type: str) -> str:
    """Return the recognised text. An empty string means silence, not failure."""
    settings = get_settings()
    base = (settings.whisper_base_url or "").rstrip("/")
    if not base:
        raise SttError("speech recognition is not configured")

    try:
        response = httpx.post(
            f"{base}/v1/audio/transcriptions",
            files={"file": (filename, audio, content_type)},
            data={"language": settings.whisper_language, "response_format": "json"},
            timeout=settings.whisper_timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as exc:
        # Includes transport failures, timeouts and non-2xx via raise_for_status.
        log.warning("STT request failed: %s", exc)
        raise SttError("speech recognition service is unavailable") from exc
    except ValueError as exc:  # body was not JSON
        log.warning("STT returned a non-JSON body")
        raise SttError("speech recognition service returned an unreadable reply") from exc

    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str):
        log.warning("STT reply has no text field: %r", payload)
        raise SttError("speech recognition service returned no text")
    return text.strip()
```

- [ ] **Step 6: Запустить тесты и убедиться, что они проходят**

Run: `cd backend && uv run pytest tests/test_stt.py -v`
Expected: PASS, 8 passed

- [ ] **Step 7: Проверить статический анализ**

Run: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app`
Expected: exit 0

- [ ] **Step 8: Commit**

```bash
git add backend/app/config.py backend/app/services/stt.py backend/tests/test_stt.py backend/tests/conftest.py
git commit -m "feat(stt): сервис распознавания речи через self-hosted Whisper"
```

---

### Task 3: Эндпоинт `POST /ai/transcribe`

HTTP-обвязка над сервисом: авторизация, лимит размера, отображение отказов в коды ответа. Здесь же — объявление зависимости `python-multipart` и проброс переменных в compose.

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/api/ai.py`
- Modify: `backend/pyproject.toml`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Test: `backend/tests/test_stt.py` (дописывается)

**Interfaces:**
- Consumes: `app.services.stt.{SttError, stt_configured, transcribe}` из задачи 2; `app.api.deps.get_current_user` (уже применён к роутеру `ai` целиком).
- Produces:
  - `app.schemas.TranscriptionOut(text: str)`
  - HTTP-контракт `POST /api/v1/ai/transcribe`: `multipart/form-data`, поле `file`; ответ `200 {"text": "..."}`.

- [ ] **Step 1: Написать падающие тесты эндпоинта**

Дописать в конец `backend/tests/test_stt.py`:

```python
def _audio_file(size: int = 32) -> dict:
    return {"file": ("audio.webm", b"\x00" * size, "audio/webm")}


def test_transcribe_endpoint_requires_auth(client):
    response = client.post("/api/v1/ai/transcribe", files=_audio_file())
    assert response.status_code == 401


def test_transcribe_endpoint_returns_text(auth_client, monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(stt_svc, "transcribe", lambda *args: "купить молоко")

    response = auth_client.post("/api/v1/ai/transcribe", files=_audio_file())

    assert response.status_code == 200, response.text
    assert response.json() == {"text": "купить молоко"}


def test_transcribe_endpoint_passes_filename_and_content_type(auth_client, monkeypatch):
    _configure(monkeypatch)
    captured: dict = {}

    def fake_transcribe(audio: bytes, filename: str, content_type: str) -> str:
        captured.update(audio=audio, filename=filename, content_type=content_type)
        return "ок"

    monkeypatch.setattr(stt_svc, "transcribe", fake_transcribe)

    auth_client.post(
        "/api/v1/ai/transcribe", files={"file": ("audio.mp4", b"abc", "audio/mp4")}
    )

    assert captured == {"audio": b"abc", "filename": "audio.mp4", "content_type": "audio/mp4"}


def test_transcribe_endpoint_503_when_disabled(auth_client, monkeypatch):
    monkeypatch.setenv("WHISPER_BASE_URL", "")
    get_settings.cache_clear()

    response = auth_client.post("/api/v1/ai/transcribe", files=_audio_file())

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "stt_disabled"


def test_transcribe_endpoint_413_when_audio_too_large(auth_client, monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setenv("WHISPER_MAX_AUDIO_MB", "0.001")  # 1048 bytes
    get_settings.cache_clear()

    response = auth_client.post("/api/v1/ai/transcribe", files=_audio_file(size=4096))

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "audio_too_large"


def test_transcribe_endpoint_502_on_upstream_failure(auth_client, monkeypatch):
    _configure(monkeypatch)

    def boom(*args):
        raise stt_svc.SttError("speech recognition service is unavailable")

    monkeypatch.setattr(stt_svc, "transcribe", boom)

    response = auth_client.post("/api/v1/ai/transcribe", files=_audio_file())

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "stt_upstream"


def test_transcribe_endpoint_returns_empty_text_for_silence(auth_client, monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(stt_svc, "transcribe", lambda *args: "")

    response = auth_client.post("/api/v1/ai/transcribe", files=_audio_file())

    assert response.status_code == 200
    assert response.json() == {"text": ""}
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `cd backend && uv run pytest tests/test_stt.py -v -k endpoint`
Expected: FAIL — эндпоинта нет, ответы 404 вместо ожидаемых кодов

- [ ] **Step 3: Объявить зависимость python-multipart**

`UploadFile` в FastAPI требует `python-multipart`. Сейчас пакет присутствует в окружении транзитивно, но в `backend/pyproject.toml` не объявлен — работоспособность держится на случайности. В список `dependencies`, после строки `"httpx>=0.27",`, добавить:

```toml
    "python-multipart>=0.0.9",
```

Затем: `cd backend && uv sync`

- [ ] **Step 4: Добавить схему ответа**

В `backend/app/schemas.py`, в конец файла, добавить:

```python
class TranscriptionOut(BaseModel):
    """Recognised speech. An empty string is a valid result (silence)."""

    text: str
```

- [ ] **Step 5: Реализовать эндпоинт**

В `backend/app/api/ai.py` заменить блок импортов на:

```python
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
```

В конец того же файла добавить:

```python
# Read the upload in chunks: Content-Length is client-controlled and must not be
# trusted as a size guard.
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
```

- [ ] **Step 6: Запустить тесты и убедиться, что они проходят**

Run: `cd backend && uv run pytest tests/test_stt.py -v`
Expected: PASS, 15 passed

- [ ] **Step 7: Прогнать весь бэкенд, чтобы новый роут ничего не сломал**

Run: `cd backend && uv run pytest -q`
Expected: PASS, ни одного упавшего теста

- [ ] **Step 8: Пробросить переменные в compose**

В `docker-compose.yml`, в блок `services.app.environment`, после строки `MCP_TOKEN: ${MCP_TOKEN:-}`, добавить:

```yaml
      WHISPER_BASE_URL: ${WHISPER_BASE_URL:-}
      WHISPER_LANGUAGE: ${WHISPER_LANGUAGE:-ru}
      WHISPER_TIMEOUT_SECONDS: ${WHISPER_TIMEOUT_SECONDS:-60}
      WHISPER_MAX_AUDIO_MB: ${WHISPER_MAX_AUDIO_MB:-10}
```

- [ ] **Step 9: Задокументировать переменные в .env.example**

В `.env.example`, перед строкой `APP_ENV=prod`, вставить:

```
# Распознавание речи: self-hosted Whisper с OpenAI-совместимым
# /v1/audio/transcriptions (ADR-0007). Пусто = диктовка выключена, трекер
# работает как обычно. Внутрикластерное имя сервиса из compose недостижимо —
# нужен адрес, видимый контейнеру (NodePort через host.docker.internal).
# Пример: http://host.docker.internal:30558
WHISPER_BASE_URL=
WHISPER_LANGUAGE=ru
WHISPER_TIMEOUT_SECONDS=60
WHISPER_MAX_AUDIO_MB=10

```

- [ ] **Step 10: Проверить статический анализ**

Run: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app`
Expected: exit 0

- [ ] **Step 11: Commit**

```bash
git add backend/app/api/ai.py backend/app/schemas.py backend/pyproject.toml backend/uv.lock backend/tests/test_stt.py docker-compose.yml .env.example
git commit -m "feat(stt): эндпоинт POST /ai/transcribe и конфигурация Whisper"
```

---

### Task 4: Клиент API и хук диктовки

Единица, которая знает про запись звука и загрузку всё, а потребители — ничего. После неё микрофон ещё нигде не отрисован; это следующие две задачи.

**Files:**
- Modify: `frontend/src/api.ts`
- Create: `frontend/src/lib/useDictation.ts`
- Test: `frontend/src/lib/useDictation.test.tsx`

**Interfaces:**
- Consumes: HTTP-контракт `POST /api/v1/ai/transcribe` из задачи 3.
- Produces:
  - `api.transcribe(blob: Blob): Promise<{ text: string }>`
  - `recordingSupported(): boolean`
  - `useDictation(onText: (text: string) => void): Dictation`, где
    `interface Dictation { supported: boolean; state: "idle" | "recording" | "transcribing"; error: string | null; seconds: number; toggle: () => void }`

- [ ] **Step 1: Написать падающие тесты хука**

Создать `frontend/src/lib/useDictation.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useDictation } from "./useDictation";

/** Управляемый двойник MediaRecorder: тест сам решает, когда придут данные
 * и когда запись остановится. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  state: "inactive" | "recording" = "inactive";

  constructor(
    public stream: MediaStream,
    public options?: { mimeType?: string },
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();

function mockMedia(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
}

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
}

function Harness({ onText }: { onText: (text: string) => void }) {
  const d = useDictation(onText);
  return (
    <div>
      <button onClick={d.toggle}>микрофон</button>
      <span data-testid="state">{d.state}</span>
      <span data-testid="supported">{String(d.supported)}</span>
      <span data-testid="error">{d.error ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  stopTrack.mockClear();
  mockMedia(() => Promise.resolve(fakeStream()));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDictation", () => {
  it("проходит путь запись → расшифровка → текст", async () => {
    vi.spyOn(api, "transcribe").mockResolvedValue({ text: "купить молоко" });
    const onText = vi.fn();
    render(<Harness onText={onText} />);

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("state")).toHaveTextContent("recording");

    await act(async () => {
      FakeMediaRecorder.instances[0].stop();
    });

    expect(onText).toHaveBeenCalledWith("купить молоко");
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("отпускает микрофон после остановки", async () => {
    vi.spyOn(api, "transcribe").mockResolvedValue({ text: "ок" });
    render(<Harness onText={vi.fn()} />);

    await userEvent.click(screen.getByRole("button"));
    await act(async () => {
      FakeMediaRecorder.instances[0].stop();
    });

    expect(stopTrack).toHaveBeenCalled();
  });

  it("объясняет отказ в доступе к микрофону", async () => {
    mockMedia(() => Promise.reject(new Error("NotAllowedError")));
    render(<Harness onText={vi.fn()} />);

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("error")).toHaveTextContent(/микрофон/i);
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("показывает ошибку сервера и не зовёт onText", async () => {
    vi.spyOn(api, "transcribe").mockRejectedValue(new Error("Сервис распознавания недоступен"));
    const onText = vi.fn();
    render(<Harness onText={onText} />);

    await userEvent.click(screen.getByRole("button"));
    await act(async () => {
      FakeMediaRecorder.instances[0].stop();
    });

    expect(screen.getByTestId("error")).toHaveTextContent(/недоступен/i);
    expect(onText).not.toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("сообщает о тишине вместо вставки пустой строки", async () => {
    vi.spyOn(api, "transcribe").mockResolvedValue({ text: "" });
    const onText = vi.fn();
    render(<Harness onText={onText} />);

    await userEvent.click(screen.getByRole("button"));
    await act(async () => {
      FakeMediaRecorder.instances[0].stop();
    });

    expect(onText).not.toHaveBeenCalled();
    expect(screen.getByTestId("error")).toHaveTextContent(/не распознано/i);
  });

  it("без API записи не поддерживается и объясняет причину", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    render(<Harness onText={vi.fn()} />);

    expect(screen.getByTestId("supported")).toHaveTextContent("false");

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("error")).toHaveTextContent(/https/i);
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `cd frontend && npx vitest run src/lib/useDictation.test.tsx`
Expected: FAIL — `Failed to resolve import "./useDictation"`

- [ ] **Step 3: Научить request() отправлять FormData**

В `frontend/src/api.ts` заменить тело `request` (строки с `fetch`) так, чтобы заголовок не навязывался для `FormData`:

```ts
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Content-Type для FormData обязан выставлять браузер: ему нужно
  // дописать boundary, которого у нас нет.
  const isForm = options.body instanceof FormData;
  const response = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    headers: options.body && !isForm ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
```

Остальная часть функции не меняется.

- [ ] **Step 4: Добавить метод transcribe в клиент**

В `frontend/src/api.ts`, в объект `api`, после метода `enhance`, добавить:

```ts
  transcribe: (blob: Blob) => {
    const form = new FormData();
    // Имя файла нужно Whisper для выбора декодера: Safari отдаёт mp4, Chrome — webm.
    form.append("file", blob, blob.type.includes("mp4") ? "audio.mp4" : "audio.webm");
    return request<{ text: string }>("/ai/transcribe", { method: "POST", body: form });
  },
```

- [ ] **Step 5: Написать хук**

Создать `frontend/src/lib/useDictation.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";

export type DictationState = "idle" | "recording" | "transcribing";

export interface Dictation {
  /** false — браузер не даёт записывать (чаще всего страница открыта по HTTP). */
  supported: boolean;
  state: DictationState;
  error: string | null;
  /** Длительность текущей записи для индикатора. */
  seconds: number;
  toggle: () => void;
}

/** Предел одной записи. Ограничивает и размер загрузки (бэкенд режет на
 * WHISPER_MAX_AUDIO_MB), и время ожидания расшифровки. */
const MAX_SECONDS = 120;

/** Chrome отдаёт webm/opus, Safari — mp4/aac; Whisper декодирует оба через
 * ffmpeg. Пустая строка — пусть браузер выберет сам. */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

export function recordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

function pickMimeType(): string {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? "";
}

export function useDictation(onText: (text: string) => void): Dictation {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // onText пересоздаётся на каждом рендере потребителя. Держим его в ref,
  // иначе обработчики MediaRecorder замкнулись бы на устаревшую версию.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // window трогаем только на клиенте и только один раз
  const supported = useMemo(recordingSupported, []);

  // Размонтирование во время записи (закрыли модалку) не должно оставлять
  // гореть индикатор микрофона в браузере.
  useEffect(
    () => () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (state !== "recording") return;
    setSeconds(0);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) recorderRef.current?.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [state]);

  const start = useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Нет доступа к микрофону — разрешите в настройках браузера");
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size === 0) {
        setState("idle");
        return;
      }
      setState("transcribing");
      try {
        const { text } = await api.transcribe(blob);
        if (text) onTextRef.current(text);
        else setError("Ничего не распознано");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось распознать речь");
      } finally {
        setState("idle");
      }
    };

    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
  }, []);

  const toggle = useCallback(() => {
    if (!supported) {
      setError("Диктовка требует HTTPS — откройте трекер по https://");
      return;
    }
    if (state === "transcribing") return; // повторный тап не должен рвать загрузку
    if (state === "recording") recorderRef.current?.stop();
    else void start();
  }, [supported, state, start]);

  return { supported, state, error, seconds, toggle };
}
```

- [ ] **Step 6: Запустить тесты и убедиться, что они проходят**

Run: `cd frontend && npx vitest run src/lib/useDictation.test.tsx`
Expected: PASS, 6 passed

- [ ] **Step 7: Проверить типы**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: exit 0

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api.ts frontend/src/lib/useDictation.ts frontend/src/lib/useDictation.test.tsx
git commit -m "feat(ui): хук диктовки на MediaRecorder и загрузка аудио в API"
```

---

### Task 5: Микрофон в QuickAdd вместо Web Speech API

Здесь Web Speech API удаляется из проекта окончательно.

**Files:**
- Delete: `frontend/src/lib/speech.ts`
- Modify: `frontend/src/components/QuickAdd.tsx`
- Test: `frontend/src/components/QuickAdd.test.tsx` (создаётся)

**Interfaces:**
- Consumes: `useDictation` из задачи 4.
- Produces: ничего для последующих задач.

- [ ] **Step 1: Написать падающий тест компонента**

Создать `frontend/src/components/QuickAdd.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types";
import QuickAdd from "./QuickAdd";

const mockDictation = vi.hoisted(() => ({
  supported: true,
  state: "idle" as "idle" | "recording" | "transcribing",
  error: null as string | null,
  seconds: 0,
  toggle: vi.fn(),
}));

vi.mock("../lib/useDictation", () => ({
  useDictation: () => mockDictation,
  recordingSupported: () => mockDictation.supported,
}));

const PROJECTS: Project[] = [
  {
    id: 1,
    name: "Inbox",
    color: "#6b7280",
    description: "",
    is_inbox: true,
    archived_at: null,
    active_tasks: 0,
  },
];

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("QuickAdd — диктовка", () => {
  it("кнопка микрофона запускает диктовку", async () => {
    mockDictation.state = "idle";
    mockDictation.error = null;
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    await userEvent.click(screen.getByRole("button", { name: /надиктовать/i }));

    expect(mockDictation.toggle).toHaveBeenCalled();
  });

  it("во время расшифровки кнопка недоступна", () => {
    mockDictation.state = "transcribing";
    mockDictation.error = null;
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    expect(screen.getByRole("button", { name: /распознаю/i })).toBeDisabled();
  });

  it("ошибка диктовки видна пользователю", () => {
    mockDictation.state = "idle";
    mockDictation.error = "Диктовка требует HTTPS — откройте трекер по https://";
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    expect(screen.getByText(/требует https/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run src/components/QuickAdd.test.tsx`
Expected: FAIL — `vi.mock` ссылается на несуществующий `../lib/useDictation`, либо кнопка не найдена

- [ ] **Step 3: Заменить движок диктовки в QuickAdd**

В `frontend/src/components/QuickAdd.tsx`:

1. В импортах заменить строку

```ts
import { getSpeechRecognition, type SpeechRecognitionLike } from "../lib/speech";
```

на

```ts
import { useDictation } from "../lib/useDictation";
```

2. Удалить состояние и рефы Web Speech API — строки, объявляющие `listening`, `interim`, `micError`, `recognitionRef`, `finalIndexRef` и `speechCtor`:

```ts
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalIndexRef = useRef(0);
  const speechCtor = useMemo(() => getSpeechRecognition(), []);
```

Вместо них после объявления `queryClient` вставить:

```ts
  // Расшифровка дописывается к тому, что уже набрано руками
  const dictation = useDictation((text) =>
    setText((prev) => (prev ? `${prev.trimEnd()} ${text}` : text)),
  );
```

3. Удалить целиком функцию `toggleDictation` и два эффекта Web Speech API:

```ts
  useEffect(() => () => recognitionRef.current?.stop(), []);

  useEffect(() => {
    if (!micError) return;
    const timer = setTimeout(() => setMicError(null), 6000);
    return () => clearTimeout(timer);
  }, [micError]);
```

Отдельный таймер скрытия ошибки больше не нужен: хук сбрасывает `error` в начале каждой попытки записи.

4. Заменить блок подсказок над полем ввода (`<div aria-live="polite">` с `micError` и следующий за ним блок с `interim`) на:

```tsx
            <div aria-live="polite">
              {dictation.error && (
                <span className="block max-w-full truncate rounded-md border border-edge bg-surface px-2 py-1 font-mono text-[11px] text-danger shadow-xl">
                  {dictation.error}
                </span>
              )}
            </div>
            {!dictation.error && dictation.state === "recording" && (
              <span
                aria-hidden="true"
                className="block max-w-full truncate rounded-md border border-edge bg-surface px-2 py-1 font-mono text-[11px] text-dim italic shadow-xl"
              >
                запись… {dictation.seconds}с
              </span>
            )}
```

5. Заменить условно отрисовываемую кнопку микрофона (`{speechCtor && (<button …>)}`) на безусловную — причину недоступности теперь объясняет подсказка, а не молчаливое отсутствие кнопки:

```tsx
        <button
          type="button"
          onClick={dictation.toggle}
          disabled={dictation.state === "transcribing"}
          aria-label={
            dictation.state === "recording"
              ? "Остановить диктовку"
              : dictation.state === "transcribing"
                ? "Распознаю речь"
                : "Надиктовать задачу"
          }
          title={
            dictation.state === "recording"
              ? "Остановить диктовку"
              : dictation.state === "transcribing"
                ? "Распознаю речь"
                : "Надиктовать задачу"
          }
          className={`btn-icon h-11 w-11 md:h-10 md:w-10 disabled:opacity-40 ${
            dictation.state === "recording" ? "mic-live" : ""
          }`}
        >
          <svg
            aria-hidden="true"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </button>
```

6. Обновить комментарий-заголовок компонента: заменить предложение

```
 * Микрофон диктует
 * в то же поле (Web Speech API, ru-RU) — есть только в браузерах с API. */
```

на

```
 * Микрофон диктует
 * в то же поле: запись уходит на собственный Whisper (ADR-0007). */
```

7. Проверить импорт `useMemo` из `react`: если после удаления `speechCtor` он больше нигде в файле не используется, убрать его из списка импортов.

- [ ] **Step 4: Удалить обёртку над Web Speech API**

```bash
git rm frontend/src/lib/speech.ts
```

- [ ] **Step 5: Убедиться, что на Web Speech API не осталось ссылок**

Run: `grep -rn "SpeechRecognition\|lib/speech" frontend/src/`
Expected: пустой вывод

- [ ] **Step 6: Запустить тесты и убедиться, что они проходят**

Run: `cd frontend && npx vitest run`
Expected: PASS, все файлы тестов зелёные

- [ ] **Step 7: Проверить типы**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: exit 0

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/QuickAdd.tsx frontend/src/components/QuickAdd.test.tsx frontend/src/lib/speech.ts
git commit -m "feat(ui): диктовка в QuickAdd через Whisper вместо Web Speech API"
```

---

### Task 6: Микрофон у поля «Описание»

`TaskForm` используется модалками создания, редактирования и черновика, поэтому одна правка даёт диктовку во всех трёх.

**Files:**
- Modify: `frontend/src/components/TaskForm.tsx`
- Test: `frontend/src/components/TaskForm.test.tsx` (создаётся)

**Interfaces:**
- Consumes: `useDictation` из задачи 4; существующий проп `onChange(values: TaskFormValues)`.
- Produces: ничего для последующих задач.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/src/components/TaskForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types";
import TaskForm, { parseTags, type TaskFormValues } from "./TaskForm";

const onTextRef = vi.hoisted(() => ({ current: (_: string) => {} }));
const mockDictation = vi.hoisted(() => ({
  supported: true,
  state: "idle" as "idle" | "recording" | "transcribing",
  error: null as string | null,
  seconds: 0,
  toggle: vi.fn(),
}));

vi.mock("../lib/useDictation", () => ({
  useDictation: (onText: (text: string) => void) => {
    onTextRef.current = onText;
    return mockDictation;
  },
  recordingSupported: () => mockDictation.supported,
}));

const PROJECTS: Project[] = [
  {
    id: 1,
    name: "Inbox",
    color: "#6b7280",
    description: "",
    is_inbox: true,
    archived_at: null,
    active_tasks: 0,
  },
];

const VALUES: TaskFormValues = {
  title: "Задача",
  description: "",
  project_id: 1,
  status: "todo",
  priority: "medium",
  tags: "",
  due_date: "",
};

describe("TaskForm — диктовка описания", () => {
  it("расшифровка дописывается в описание", async () => {
    const onChange = vi.fn();
    render(<TaskForm values={VALUES} projects={PROJECTS} onChange={onChange} />);

    onTextRef.current("проверить бэкапы");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ description: "проверить бэкапы" }),
    );
  });

  it("расшифровка не затирает уже набранное описание", () => {
    const onChange = vi.fn();
    render(
      <TaskForm
        values={{ ...VALUES, description: "Начало." }}
        projects={PROJECTS}
        onChange={onChange}
      />,
    );

    onTextRef.current("Продолжение.");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Начало. Продолжение." }),
    );
  });

  it("кнопка микрофона запускает диктовку", async () => {
    render(<TaskForm values={VALUES} projects={PROJECTS} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /надиктовать описание/i }));

    expect(mockDictation.toggle).toHaveBeenCalled();
  });

  it("parseTags остаётся прежним", () => {
    expect(parseTags(" Infra, HOME ,, ")).toEqual(["infra", "home"]);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run src/components/TaskForm.test.tsx`
Expected: FAIL — кнопка `надиктовать описание` не найдена

- [ ] **Step 3: Добавить микрофон к полю описания**

В `frontend/src/components/TaskForm.tsx`:

1. В импортах добавить:

```ts
import { useDictation } from "../lib/useDictation";
```

2. После строки `const errorId = useId();` вставить:

```ts
  // Диктовка дописывает текст к описанию, а не заменяет его: пользователь
  // мог начать печатать до того, как взялся за микрофон.
  const dictation = useDictation((text) =>
    set({ description: values.description ? `${values.description.trimEnd()} ${text}` : text }),
  );
```

3. Заменить блок `<label>` с полем «Описание» на:

```tsx
      <div>
        <div className="flex items-end justify-between gap-2">
          <span className="eyebrow">Описание · markdown</span>
          <button
            type="button"
            onClick={dictation.toggle}
            disabled={dictation.state === "transcribing"}
            aria-label={
              dictation.state === "recording"
                ? "Остановить диктовку описания"
                : dictation.state === "transcribing"
                  ? "Распознаю речь"
                  : "Надиктовать описание"
            }
            className={`btn-icon h-8 w-8 disabled:opacity-40 ${
              dictation.state === "recording" ? "mic-live" : ""
            }`}
          >
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </button>
        </div>
        <textarea
          name="description"
          aria-label="Описание"
          value={values.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={5}
          className="input font-mono text-[13px]"
        />
        <span aria-live="polite">
          {dictation.error && <span className="field-error">{dictation.error}</span>}
          {!dictation.error && dictation.state === "recording" && (
            <span className="font-mono text-[11px] text-dim">запись… {dictation.seconds}с</span>
          )}
          {dictation.state === "transcribing" && (
            <span className="font-mono text-[11px] text-dim">распознаю…</span>
          )}
        </span>
      </div>
```

`<label>` заменён на `<div>` намеренно: клик по подписи не должен попадать в кнопку микрофона, поэтому `textarea` получает явный `aria-label` вместо связи через обёртку.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `cd frontend && npx vitest run src/components/TaskForm.test.tsx`
Expected: PASS, 4 passed

- [ ] **Step 5: Прогнать весь фронтенд — правка TaskForm видна модалкам**

Run: `cd frontend && npx vitest run && npx tsc -b --noEmit`
Expected: PASS и exit 0

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/TaskForm.tsx frontend/src/components/TaskForm.test.tsx
git commit -m "feat(ui): диктовка описания задачи"
```

---

### Task 7: HTTPS-сайт Caddy и ранбук

Предусловие работоспособности всей функции: без secure context браузер не отдаст микрофон. Тестов у задачи нет — конфигурация проверяется на деплое, который в этот план не входит.

**Files:**
- Modify: `deploy/Caddyfile`
- Modify: `DEPLOYMENT.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: решение ADR-0006 из задачи 1.
- Produces: переменную окружения `TT_HTTPS_ADDR` для сервиса `caddy`.

- [ ] **Step 1: Добавить HTTPS-сайт в Caddyfile**

В конец `deploy/Caddyfile` добавить:

```
# HTTPS в LAN (ADR-0006). Нужен не ради шифрования, а ради secure context:
# без него браузер не отдаёт микрофон (getUserMedia) — то есть не работает
# диктовка. Адрес host-специфичный, поэтому приходит из окружения:
# TT_HTTPS_ADDR=https://192.168.1.55:27183
#
# Сертификат выпускает внутренний CA Caddy; его корень лежит в томе caddy_data
# (/data/caddy/pki/authorities/local/root.crt) и ставится на устройства.
#
# Этот путь идёт мимо фронтящего nginx, поэтому ACL по адресам LAN повторён
# здесь: наружу по-прежнему не открыто ничего (ADR-0004).
{$TT_HTTPS_ADDR:https://localhost} {
	tls internal
	encode gzip
	@lan remote_ip 127.0.0.0/8 192.168.0.0/16 10.0.0.0/8 172.16.0.0/12
	handle @lan {
		reverse_proxy app:8000
	}
	handle {
		abort
	}
}
```

- [ ] **Step 2: Пробросить переменную в сервис caddy**

В `docker-compose.yml`, в сервис `caddy`, после строки `image: caddy:2-alpine` добавить блок:

```yaml
    environment:
      TT_HTTPS_ADDR: ${TT_HTTPS_ADDR:-https://localhost}
```

- [ ] **Step 3: Задокументировать переменную в .env.example**

В `.env.example`, сразу после блока `WHISPER_*`, добавить:

```
# Адрес HTTPS-сайта в LAN (ADR-0006). Нужен для диктовки: браузер не даёт
# доступ к микрофону на странице, открытой по HTTP. Порт должен совпадать с
# опубликованным у сервиса caddy. Пример: https://192.168.1.55:27183
TT_HTTPS_ADDR=https://localhost

```

Кроме того, заменить блок про `COOKIE_SECURE`:

```
# Mark the session cookie Secure. Keep false while the stack serves plain HTTP;
# set to true when switching Caddy to TLS (`tls internal`, ADR-0004).
COOKIE_SECURE=false
```

на:

```
# Mark the session cookie Secure. Set to true together with TT_HTTPS_ADDR
# (ADR-0006): с true UI логинится только по HTTPS, а HTTP-вход остаётся
# рабочим для MCP-агентов — они авторизуются Bearer-токеном, а не кукой.
COOKIE_SECURE=false
```

- [ ] **Step 4: Проверить синтаксис Caddyfile**

Run: `docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" -e TT_HTTPS_ADDR=https://192.168.1.55:27183 caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile`
Expected: `Valid configuration`

- [ ] **Step 5: Дописать в ранбук раздел про HTTPS**

В `DEPLOYMENT.md` заменить пункт 3 списка недостающих фактов:

```
3. решение HTTP vs `tls internal` в LAN (см. ADR-0004).
```

на:

```
3. ~~решение HTTP vs `tls internal` в LAN~~ — принято, см. ADR-0006 и раздел
   «HTTPS в LAN» ниже.
```

В разделе «Требования к серверу» заменить строку про порты на:

```
- Открытые внутрь LAN порты 80 и порт HTTPS-сайта из `TT_HTTPS_ADDR` (например 27183).
  Наружу — ничего (ADR-0004).
```

Перед разделом «## MCP-токен для агентов» вставить новый раздел:

````markdown
## HTTPS в LAN (обязателен для диктовки)

Голосовой ввод требует secure context: на странице, открытой по HTTP, браузер не даёт
доступ к микрофону. Настройка разовая (ADR-0006).

1. Задать адрес и включить Secure-куку в `.env`:

```
TT_HTTPS_ADDR=https://<ip-сервера>:27183
COOKIE_SECURE=true
APP_ENV=prod
```

2. Опубликовать порт у сервиса `caddy` (в host-специфичном
   `docker-compose.override.yml`, если он используется):

```yaml
services:
  caddy:
    ports:
      - "27183:27183"
```

3. Открыть порт в межсетевом экране, иначе сайт будет доступен только с самого
   сервера:

```bash
sudo ufw allow 27183/tcp
```

4. Поднять стек и забрать корневой сертификат внутреннего CA:

```bash
docker compose up -d
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
```

5. Установить `caddy-root.crt` на каждое устройство, с которого открывается трекер.
   На iOS: передать файл на устройство → Settings → Profile Downloaded → Install →
   затем **обязательно** Settings → General → About → Certificate Trust Settings →
   включить полное доверие. Без второго шага сертификат установлен, но не доверен.
   На Android: Settings → Security → Encryption & credentials → Install a certificate →
   CA certificate. На macOS: Keychain Access → System → импортировать → Always Trust.

Проверка:

```bash
curl -fsS --cacert caddy-root.crt https://<ip-сервера>:27183/healthz   # {"ok":true}
```

С устройства: открыть `https://<ip-сервера>:27183/` — замок без предупреждений, вход
работает, кнопка микрофона диктует.

HTTP-вход на :27182 остаётся рабочим для MCP-агентов: они авторизуются Bearer-токеном,
которому флаг Secure не мешает. UI по HTTP после `COOKIE_SECURE=true` не залогинится —
это ожидаемо.
````

В таблицу «Диагностика» добавить три строки:

```
| Кнопка микрофона говорит «требует HTTPS» | страница открыта по HTTP — зайти по адресу из `TT_HTTPS_ADDR` |
| Браузер ругается на сертификат | корневой сертификат CA не установлен или не доверен (на iOS — второй шаг в Certificate Trust Settings) |
| «Сервис распознавания недоступен» | `WHISPER_BASE_URL` в `.env`; проверить `curl -fsS $WHISPER_BASE_URL/health` из контейнера `app` |
```

- [ ] **Step 6: Прогнать полный набор гейтов**

Run: `make verify`
Expected: PASS на всех трёх стадиях (lint → test → build), exit 0

- [ ] **Step 7: Commit**

```bash
git add deploy/Caddyfile docker-compose.yml .env.example DEPLOYMENT.md
git commit -m "feat(deploy): HTTPS-сайт в LAN через tls internal + ранбук"
```

---

## Проверка на живом Whisper (после реализации, до деплоя)

План покрывает код тестами с моками — сеть в тестах не используется. Но спека (раздел
5.2) требует проверить реальными данными, что Whisper принимает оба контейнера, которые
дают браузеры. Это делается один раз вручную и не является частью гейтов:

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -c:a libopus /tmp/probe.webm -y
curl -sS -F "file=@/tmp/probe.webm" -F "language=ru" http://127.0.0.1:30558/v1/audio/transcriptions
```

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -c:a aac /tmp/probe.mp4 -y
curl -sS -F "file=@/tmp/probe.mp4" -F "language=ru" http://127.0.0.1:30558/v1/audio/transcriptions
```

Ожидается 200 и JSON с полем `text` в обоих случаях (текст на синусоиде будет пустым или
мусорным — проверяется именно приём формата, а не качество распознавания). Если mp4
отвергается, у Whisper нет ffmpeg-декодера для aac — тогда в `pickMimeType` останется
только webm, а Safari потеряет диктовку; это повод вернуться к владельцу, а не
молча урезать функцию.
