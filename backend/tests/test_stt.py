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
        return httpx.Response(
            200, json={"text": "  купить молоко  "}, request=httpx.Request("POST", url)
        )

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
        return httpx.Response(200, json={"text": "ок"}, request=httpx.Request("POST", url))

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
        return httpx.Response(200, json={"unexpected": "shape"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(stt_svc.httpx, "post", fake_post)

    with pytest.raises(stt_svc.SttError):
        stt_svc.transcribe(b"a", "audio.webm", "audio/webm")


def test_transcribe_allows_empty_text(monkeypatch):
    """Silence is a valid outcome, not a failure."""
    _configure(monkeypatch)

    def fake_post(url, **kwargs):
        return httpx.Response(200, json={"text": ""}, request=httpx.Request("POST", url))

    monkeypatch.setattr(stt_svc.httpx, "post", fake_post)

    assert stt_svc.transcribe(b"a", "audio.webm", "audio/webm") == ""


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

    auth_client.post("/api/v1/ai/transcribe", files={"file": ("audio.mp4", b"abc", "audio/mp4")})

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
