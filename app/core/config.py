from __future__ import annotations

import json
import logging
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://carameli:carameli_local_dev@localhost:5432/carameli"
    carrier_provider: str = "telnyx"
    call_engine_provider: str = "jambonz"

    # Telnyx (populated by Track B)
    telnyx_api_key: str = ""
    telnyx_webhook_base_url: str = "http://localhost:8000"
    telnyx_webhook_secret: str = ""
    telnyx_messaging_profile_id: str = ""
    telnyx_sandbox: bool = False  # TELNYX_SANDBOX=1 → no real records (reconciliation returns [])

    # Jambonz (populated by Track C)
    jambonz_base_url: str = "http://localhost:3000"
    jambonz_api_key: str = ""
    jambonz_account_sid: str = ""
    jambonz_webhook_base_url: str = "http://localhost:8000"
    jambonz_webhook_secret: str = ""
    jambonz_record_all_calls: bool = False

    # S3-compatible media / recording storage (Track F)
    s3_bucket: str = ""
    s3_endpoint: str = ""  # blank = real AWS S3; set for MinIO or other S3-compatible
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_region: str = "us-east-1"

    redis_url: str = "redis://redis:6379"

    rate_limit_sms: str = "60/minute"
    rate_limit_calls: str = "30/minute"

    api_key_secret: str = "change_me"
    session_secret: str = "change_me_session_secret"

    log_level: str = "INFO"
    log_file: str = "logs/runtime/carameli.log"

    cors_origins: Annotated[list[str], NoDecode] = Field(
        default=["http://localhost:5173"],
        description="Comma-separated list of allowed CORS origins",
    )

    vanillasoft_webhook_url: str | None = Field(
        default=None,
        description=(
            "Base URL of the VanillaSoft.CloudliApi staging site; Carameli POSTs "
            "IncomingCall, CallRecording, IncomingSmsMessage and "
            "IncomingSmsMessageDeliveryReceipt under it, behind "
            "VANILLASOFT_NOTIFY_PREFIX"
        ),
    )
    vanillasoft_webhook_secret: str | None = None

    # Reconciliation cron (phase 04): diffs provider records against local tables to
    # catch webhooks that never arrived. Default-off — needs live provider credentials.
    reconciliation_enabled: bool = False
    reconciliation_lookback_minutes: int = 60
    vanillasoft_notify_prefix: str = Field(
        default="notify",
        description=(
            "Path prefix inserted between the webhook base URL and the notify "
            "suffixes (IncomingCall, CallRecording, ...). 'notify' targets the "
            "legacy fire-and-forget CloudliController; flip to 'carameli/notify' "
            "once staging runs the honest CarameliNotifyController"
        ),
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            raw_value = v.strip()
            if not raw_value:
                return []

            if raw_value.startswith("["):
                try:
                    parsed = json.loads(raw_value)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    return [s for origin in parsed if (s := str(origin).strip())]

            return [origin.strip() for origin in raw_value.split(",") if origin.strip()]

        return [origin.strip() for origin in v if origin.strip()]


settings = Settings()
