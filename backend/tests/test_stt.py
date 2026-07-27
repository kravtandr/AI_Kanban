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
