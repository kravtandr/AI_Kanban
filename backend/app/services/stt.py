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
