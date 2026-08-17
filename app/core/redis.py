from __future__ import annotations

import logging
from collections.abc import AsyncGenerator

import redis.asyncio as aioredis
from arq.connections import ArqRedis

from app.core.config import settings

logger = logging.getLogger(__name__)

_pool: aioredis.ConnectionPool | None = None
_arq_pool: aioredis.ConnectionPool | None = None


def _get_pool() -> aioredis.ConnectionPool:
    global _pool
    if _pool is None:
        _pool = aioredis.ConnectionPool.from_url(
            settings.redis_url,
            decode_responses=True,
        )
    return _pool


def _get_arq_pool() -> aioredis.ConnectionPool:
    """Return the shared pool ARQ enqueues through.

    Separate from `_get_pool` because ARQ serialises job payloads as bytes and
    must not run on a `decode_responses=True` connection.
    """
    global _arq_pool
    if _arq_pool is None:
        _arq_pool = aioredis.ConnectionPool.from_url(settings.redis_url)
    return _arq_pool


def get_redis_client() -> aioredis.Redis:
    """Return a Redis client backed by the shared connection pool."""
    return aioredis.Redis(connection_pool=_get_pool())


async def get_redis() -> AsyncGenerator[aioredis.Redis, None]:
    """FastAPI dependency that yields a Redis client."""
    client = get_redis_client()
    try:
        yield client
    finally:
        await client.aclose()


def get_arq_client() -> ArqRedis:
    """Return an ARQ client backed by the shared ARQ connection pool.

    Deliberately not `arq.create_pool`: that opens a fresh pool per call and
    pings it behind a retry-and-sleep loop, so an unreachable Redis costs every
    request seconds of blocking retries instead of failing on the first command.
    """
    return ArqRedis(connection_pool=_get_arq_pool())


async def get_arq_redis() -> AsyncGenerator[ArqRedis, None]:
    """FastAPI dependency that yields an ARQ-capable client."""
    client = get_arq_client()
    try:
        yield client
    finally:
        await client.aclose()
