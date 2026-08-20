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
    # Owned Telnyx numbers for the live sandbox SMS tests. Telnyx has no Twilio-style
    # magic test numbers (+1500555xxxx is rejected with "Invalid source number"), so
    # the from-number must be a real DID on the account's messaging profile.
    telnyx_test_from_number: str = ""
    telnyx_test_to_number: str = ""

    # Jambonz (populated by Track C)
    jambonz_base_url: str = "http://localhost:3000"
    jambonz_api_key: str = ""
    jambonz_account_sid: str = ""
    jambonz_webhook_base_url: str = "http://localhost:8000"
    jambonz_webhook_secret: str = ""
    jambonz_record_all_calls: bool = False
    # Carrier trunk name to pin device-originated PSTN calls to. Blank lets Jambonz
    # pick, which is correct while the account has exactly one carrier configured.
    jambonz_outbound_trunk: str = ""
    sip_credential_encryption_secret: str = ""

    # Browser softphone. The WSS endpoint is derived from the extension's own SIP
    # realm (`wss://<realm>:<port>`); set sip_wss_url to override the whole URI when
    # the SBC is not reachable there.
    sip_wss_port: int = 8443
    sip_wss_url: str = ""

    # Per-call SCI context is intentionally short-lived. VanillaSoft posts it
    # immediately before originating the corresponding call.
    sci_preparation_ttl_seconds: int = Field(default=300, ge=30, le=3600)

    # S3-compatible media / recording storage (Track F)
    s3_bucket: str = ""
    s3_endpoint: str = ""  # blank = real AWS S3; set for MinIO or other S3-compatible
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_region: str = "us-east-1"

    redis_url: str = "redis://redis:6379"
    heartbeat_url: str = ""

    # Shared retention window for posted call/SMS history and recording objects.
    # Zero (or a negative value) leaves retention disabled.
    retention_days: int = 0

    # Archive limits bound worker memory, S3 reads, and ZIP fan-out.
    recording_archive_max_files: int = Field(default=500, ge=1, le=5000)
    recording_archive_max_file_bytes: int = Field(
        default=100 * 1024 * 1024, ge=1, le=1024 * 1024 * 1024
    )
    recording_archive_max_total_bytes: int = Field(
        default=1024 * 1024 * 1024, ge=1, le=10 * 1024 * 1024 * 1024
    )

    rate_limit_sms: str = "60/minute"
    rate_limit_calls: str = "30/minute"

    api_key_secret: str = "change_me"
    session_secret: str = "change_me_session_secret"

    log_level: str = "INFO"
    log_file: str = "logs/runtime/carameli.log"

    sentry_dsn: str = ""
    sentry_environment: str = "dev"
    sentry_traces_sample_rate: float = 0.0

    cors_origins: Annotated[list[str], NoDecode] = Field(
        default=["http://localhost:5173"],
        description="Comma-separated list of allowed CORS origins",
    )

    vanillasoft_webhook_url: str | None = Field(
        default=None,
        description=(
            "Base URL of the VanillaSoft.VoipApi staging site; Carameli POSTs "
            "IncomingCall, CallRecording, IncomingSmsMessage and "
            "IncomingSmsMessageDeliveryReceipt under it, behind "
            "VANILLASOFT_NOTIFY_PREFIX"
        ),
    )
    vanillasoft_webhook_secret: str | None = None
    carameli_notify_secret: str | None = Field(
        default=None,
        description=(
            "Carameli's own HMAC-SHA256 signing key for outbound notify POSTs, sent as "
            "X-Carameli-Signature. Deliberately separate from "
            "VANILLASOFT_WEBHOOK_SECRET: that value is the legacy vendor's static "
            "shared header (the CloudliAuthValue appSetting), so reusing it would mean "
            "rotating one vendor rotates both. Unset = no "
            "signature header (the pre-signing behaviour)"
        ),
    )

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
