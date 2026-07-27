from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./tasktracker.db"
    app_env: str = "dev"

    # Mark the session cookie Secure. Decoupled from app_env: the LAN deployment
    # serves plain HTTP (ADR-0004), so this must be opt-in when TLS is enabled.
    cookie_secure: bool = False

    # IANA timezone used to compute "today" boundaries (daily summary). Env: TIMEZONE.
    timezone: str = "UTC"

    session_ttl_days: int = 30
    login_rate_limit_attempts: int = 5
    login_rate_limit_window_seconds: int = 300

    # Initial admin account, created on first start if the users table is empty.
    admin_username: str | None = None
    admin_password: str | None = None

    # LLM provider: "anthropic" (Claude API) or "openai" (any OpenAI-compatible
    # /v1/chat/completions endpoint, e.g. a self-hosted model). ADR-0005.
    llm_provider: str = "anthropic"
    llm_timeout_seconds: float = 15.0

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-4-8"

    openai_base_url: str | None = None  # e.g. https://host:9443/v1
    openai_api_key: str | None = None
    openai_model: str = ""

    # Self-hosted Whisper for speech-to-text (ADR-0007). An empty base URL is the
    # normal "STT disabled" state: the tracker must work without it, exactly as it
    # already works without an LLM. Base URL without a trailing path, e.g.
    # http://host.docker.internal:30558
    whisper_base_url: str | None = None
    whisper_language: str = "ru"
    whisper_timeout_seconds: float = 60.0
    whisper_max_audio_mb: float = 10.0

    # Optional static MCP token (bootstrap). DB tokens (kind=mcp) also work.
    mcp_token: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
