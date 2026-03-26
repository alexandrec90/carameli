from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from sqlalchemy.exc import DataError

from app.api.auth import router as auth_router
from app.api.vg.frontend_logs import router as frontend_logs_router
from app.api.vsapi import vsapi_router
from app.api.webhooks.call_status import jambonz_router
from app.api.webhooks.sms_inbound import router as sms_inbound_router
from app.core.config import settings
from app.core.database import engine
from app.core.limiter import limiter
from app.core.logging_config import configure_logging
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
    yield
    logger.info("Carameli stopped.")


app = FastAPI(
    title="Carameli",
    description="Self-hosted VoIP microservice — Jambonz + Telnyx backend.",
    version="1.0.0",
    lifespan=lifespan,
)

# Instrument before other middleware so metrics capture the full request lifecycle.
Instrumentator().instrument(app).expose(
    app,
    response_class=PlainTextResponse,
    responses={200: {"content": {"text/plain": {}}, "description": "Prometheus metrics"}},
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
        "falling back to ['http://localhost:5173']"
    )
    _cors_origins = ["http://localhost:5173"]

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
app.include_router(jambonz_router)
app.include_router(sms_inbound_router)
app.include_router(frontend_logs_router, responses=_UNAUTHORIZED)  # type: ignore[arg-type]


@app.get("/health")
async def health_check() -> dict:
    """Health probe — returns liveness, DB reachability, and Jambonz reachability."""
    ping_url = settings.jambonz_base_url.rstrip("/") + "/health"
    jambonz_status = "ok"
    db_status = "ok"

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:
        logger.warning("DB health probe failed: %s", exc)
        db_status = "unreachable"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(ping_url)
        if resp.is_error:
            logger.warning("Jambonz health probe returned non-2xx status=%s", resp.status_code)
            jambonz_status = "unreachable"
    except Exception as exc:
        logger.warning("Jambonz health probe failed: %s", exc)
        jambonz_status = "unreachable"

    return {"status": "ok", "service": "Carameli", "db": db_status, "jambonz": jambonz_status}
