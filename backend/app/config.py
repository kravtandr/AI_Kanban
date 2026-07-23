from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./tasktracker.db"
    app_env: str = "dev"

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

    # Optional static MCP token (bootstrap). DB tokens (kind=mcp) also work.
    mcp_token: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
