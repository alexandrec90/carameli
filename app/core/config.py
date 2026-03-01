from __future__ import annotations

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://voicegateway:voicegateway_local_dev@localhost:5432/voicegateway"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_webhook_base_url: str = "http://localhost:8000"
    twilio_api_key_sid: str = ""
    twilio_api_key_secret: str = ""
    api_key_secret: str = "change_me"

    log_level: str = "INFO"
    log_file: str = "logs/voicegateway.log"

    cors_origins: list[str] = Field(
        default=["http://localhost:3000"],
        description="Comma-separated list of allowed CORS origins",
    )

    vanillasoft_webhook_url: str | None = Field(
        default=None,
        description="VanillaSoft endpoint to POST completed call events",
    )
    vanillasoft_webhook_secret: str | None = None

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v


settings = Settings()
