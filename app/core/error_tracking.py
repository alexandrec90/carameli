from __future__ import annotations

import logging

import sentry_sdk
from sentry_sdk.integrations.arq import ArqIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration

from app.core.config import settings

logger = logging.getLogger(__name__)


def init_error_tracking() -> bool:
    """Initialise Sentry if a DSN is configured. Returns True if enabled."""
    if not settings.sentry_dsn:
        logger.info("error tracking disabled")
        return False

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        integrations=[FastApiIntegration(), ArqIntegration()],
        traces_sample_rate=settings.sentry_traces_sample_rate,
    )
    logger.info("error tracking enabled environment=%s", settings.sentry_environment)
    return True
