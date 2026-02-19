from __future__ import annotations

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


settings = Settings()
