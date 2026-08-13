from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from prometheus_fastapi_instrumentator import Instrumentator
from redis.asyncio import Redis
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from sqlalchemy.exc import DataError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import router as auth_router
from app.api.recording_download import router as recording_download_router
from app.api.rest import rest_router
from app.api.vg.frontend_logs import router as frontend_logs_router
from app.api.vsapi import vsapi_router
from app.api.webhooks.call_status import jambonz_router
from app.api.webhooks.sms_inbound import router as sms_inbound_router
from app.api.webhooks.vs_log import router as vs_log_router
from app.core.config import settings
from app.core.constants import DEFAULT_FRONTEND_ORIGIN
from app.core.database import engine, get_session
from app.core.error_tracking import init_error_tracking
from app.core.limiter import limiter
from app.core.logging_config import configure_logging
from app.core.metrics import refresh_operational_metrics
from app.core.redis import get_redis
from app.services.providers.factory import (
    get_call_engine_provider,
    get_carrier_provider,
)

configure_logging(log_level=settings.log_level, log_file=settings.log_file)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Initialise process-wide integrations before accepting traffic.
    init_error_tracking()
    logger.info("Starting Carameli…")
    app.state.carrier = get_carrier_provider()
    app.state.engine = get_call_engine_provider()
    yield
    logger.info("Carameli stopped.")


app = FastAPI(
    title="Carameli",
    description="Self-hosted VoIP microservice — Jambonz + Telnyx backend.",
    version="1.0.0",
    lifespan=lifespan,
)

# Instrument before other middleware so metrics capture the full request lifecycle.
Instrumentator().instrument(app)


@app.get(
    "/metrics",
    response_class=Response,
    responses={200: {"content": {"text/plain": {}}, "description": "Prometheus metrics"}},
)
async def metrics_endpoint(
    session: Annotated[AsyncSession, Depends(get_session)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> Response:
    """Refresh operational gauges and return the Prometheus exposition."""
    await refresh_operational_metrics(session, redis)
    return Response(
        content=generate_latest(),
        headers={"Content-Type": CONTENT_TYPE_LATEST},
    )


app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]


@app.exception_handler(DataError)
async def data_error_handler(request: Request, exc: DataError) -> JSONResponse:
    logger.warning("Invalid data in request: %s %s -- %s", request.method, request.url, exc)
    return JSONResponse(status_code=422, content={"detail": "Invalid input data"})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "Unhandled exception: %s %s",
        request.method,
        request.url,
        exc_info=exc,
    )
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.add_middleware(SlowAPIMiddleware)

# CORS spec forbids wildcard "*" when credentials are enabled — browsers reject
# such responses.  Sanitize to the default frontend origin if misconfigured.
_cors_origins = settings.cors_origins
if "*" in _cors_origins:
    logger.warning(
        "CORS_ORIGINS contains '*' which is invalid with allow_credentials=True; "
        "falling back to ['%s']",
        DEFAULT_FRONTEND_ORIGIN,
    )
    _cors_origins = [DEFAULT_FRONTEND_ORIGIN]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

_UNAUTHORIZED = {401: {"description": "Unauthorized"}}
app.include_router(auth_router)
app.include_router(vsapi_router, responses=_UNAUTHORIZED)  # type: ignore[arg-type]
app.include_router(rest_router, responses=_UNAUTHORIZED)  # type: ignore[arg-type]
app.include_router(jambonz_router)
app.include_router(sms_inbound_router)
app.include_router(vs_log_router)
app.include_router(recording_download_router)
app.include_router(frontend_logs_router, responses=_UNAUTHORIZED)  # type: ignore[arg-type]


@app.get("/health")
async def health_check() -> dict:
    """Health probe — returns liveness, DB reachability, and Jambonz reachability."""
    jambonz_status = "ok"
    db_status = "ok"

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:
        logger.warning("DB health probe failed: %s", exc)
        db_status = "unreachable"

    try:
        jambonz_url = settings.jambonz_base_url
        if jambonz_url is not None:
            ping_url = str(jambonz_url).rstrip("/") + "/health"
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(ping_url)
            if resp.is_error:
                logger.warning("Jambonz health probe returned non-2xx status=%s", resp.status_code)
                jambonz_status = "unreachable"
        else:
            jambonz_status = "not_configured"
    except Exception as exc:
        logger.warning("Jambonz health probe failed: %s", exc)
        jambonz_status = "unreachable"

    return {"status": "ok", "service": "Carameli", "db": db_status, "jambonz": jambonz_status}
