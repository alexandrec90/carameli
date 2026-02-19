from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from twilio.rest import Client

from app.api.vsapi import vsapi_router
from app.api.webhooks.call_status import router as webhooks_router
from app.core.config import settings
from app.services.call_sync import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup
    logger.info("Starting VoiceGateway…")
    app.state.twilio = Client(
        settings.twilio_account_sid, settings.twilio_auth_token
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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(vsapi_router)
app.include_router(webhooks_router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Simple health check endpoint."""
    return {"status": "ok", "service": "VoiceGateway"}
