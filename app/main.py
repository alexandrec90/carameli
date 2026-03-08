from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.vg.frontend_logs import router as frontend_logs_router
from app.api.vsapi import vsapi_router
from app.api.webhooks.call_status import jambonz_router
from app.api.webhooks.sms_inbound import router as sms_inbound_router
from app.core.config import settings
from app.core.logging_config import configure_logging
from app.services.call_sync import start_scheduler, stop_scheduler
from app.services.providers.factory import get_call_engine_provider, get_carrier_provider

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
    """Health probe — checks Jambonz reachability.

    Returns 200 when all dependencies are up, 503 when Jambonz is unreachable.
    Load balancers and orchestrators should poll this endpoint.
    """
    import httpx

    ping_url = settings.jambonz_base_url.rstrip("/") + "/v1/ping"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(ping_url)
        if resp.is_error:
            raise httpx.HTTPStatusError("non-2xx", request=resp.request, response=resp)
        jambonz_status = "ok"
    except Exception as exc:
        logger.warning("Jambonz health probe failed: %s", exc)
        from fastapi import Response
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "service": "Carameli", "jambonz": "unreachable"},
        )

    return {"status": "ok", "service": "Carameli", "jambonz": jambonz_status}
