from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.vg.frontend_logs import router as frontend_logs_router
from app.api.vsapi import vsapi_router
from app.api.webhooks.call_status import jambonz_router
from app.api.webhooks.sms_inbound import router as sms_inbound_router
from app.core.config import settings
from app.core.logging_config import configure_logging
from app.services.call_sync import start_scheduler, stop_scheduler
from app.services.providers.factory import (
    get_call_engine_provider,
    get_carrier_provider,
)

configure_logging(log_level=settings.log_level, log_file=settings.log_file)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup
    logger.info("Starting Carameli…")
    app.state.carrier = get_carrier_provider()
    app.state.engine = get_call_engine_provider()
    start_scheduler()
    yield
    # Shutdown
    stop_scheduler()
    logger.info("Carameli stopped.")


app = FastAPI(
    title="Carameli",
    description="Self-hosted VoIP microservice — Jambonz + Telnyx backend.",
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
app.include_router(jambonz_router)
app.include_router(sms_inbound_router)
app.include_router(frontend_logs_router)


@app.get("/health")
async def health_check() -> dict:
    """Health probe — returns liveness and Jambonz reachability state."""
    ping_url = settings.jambonz_base_url.rstrip("/") + "/v1/ping"
    jambonz_status = "ok"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(ping_url)
        if resp.is_error:
            logger.warning(
                "Jambonz health probe returned non-2xx status=%s", resp.status_code
            )
            jambonz_status = "unreachable"
    except Exception as exc:
        logger.warning("Jambonz health probe failed: %s", exc)
        jambonz_status = "unreachable"

    return {"status": "ok", "service": "Carameli", "jambonz": jambonz_status}
