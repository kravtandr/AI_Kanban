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

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-4-8"
    llm_timeout_seconds: float = 15.0

    # Optional static MCP token (bootstrap). DB tokens (kind=mcp) also work.
    mcp_token: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
