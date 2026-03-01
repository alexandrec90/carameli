from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from twilio.rest import Client

from app.api.vg.frontend_logs import router as frontend_logs_router
from app.api.vsapi import vsapi_router
from app.api.webhooks.call_status import router as webhooks_router
from app.core.config import settings
from app.core.logging_config import configure_logging
from app.services.call_sync import start_scheduler, stop_scheduler
from app.services.twilio_provider import TwilioProvider

configure_logging(log_level=settings.log_level, log_file=settings.log_file)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup
    logger.info("Starting VoiceGateway…")
    twilio_client = Client(
        settings.twilio_account_sid, settings.twilio_auth_token
    )
    app.state.twilio = TwilioProvider(
        client=twilio_client,
        webhook_base_url=settings.twilio_webhook_base_url,
    )
    start_scheduler()
    yield
    # Shutdown
    stop_scheduler()
    logger.info("VoiceGateway stopped.")


app = FastAPI(
    title="VoiceGateway",
    description="Self-hosted VoIP microservice built on Twilio — drop-in replacement for Cloudli/CMV.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(vsapi_router)
app.include_router(webhooks_router)
app.include_router(frontend_logs_router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Simple health check endpoint."""
    return {"status": "ok", "service": "VoiceGateway"}
