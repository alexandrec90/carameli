from __future__ import annotations

import pytest
from arq.connections import ArqRedis
from redis.asyncio.connection import Connection

from app.core import redis as redis_module
from app.core.config import settings

_asyncio_test = pytest.mark.asyncio(loop_scope="session")


@pytest.fixture(autouse=True)
def _isolated_pools(monkeypatch: pytest.MonkeyPatch) -> None:
    """Give each test its own module-level pools, restored afterwards."""
    monkeypatch.setattr(redis_module, "_pool", None)
    monkeypatch.setattr(redis_module, "_arq_pool", None)


@pytest.fixture
def _no_connect(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn any attempt to open a socket into an immediate, uncatchable failure.

    ``AssertionError`` is deliberate: ARQ's ``create_pool`` swallows
    ``ConnectionError``/``OSError``/``RedisError``/``TimeoutError`` and retries
    behind ``asyncio.sleep``, so a connection error would be reported as a slow
    test rather than a failed one.
    """

    async def _fail(self: Connection) -> None:
        raise AssertionError("resolving the dependency must not open a connection")

    monkeypatch.setattr(Connection, "connect", _fail)


def test_arq_client_reuses_one_shared_pool() -> None:
    first = redis_module.get_arq_client()
    second = redis_module.get_arq_client()

    assert isinstance(first, ArqRedis)
    assert first is not second
    assert first.connection_pool is second.connection_pool


def test_arq_pool_is_binary_and_separate_from_the_decoded_pool() -> None:
    arq_pool = redis_module.get_arq_client().connection_pool
    plain_pool = redis_module.get_redis_client().connection_pool

    assert arq_pool is not plain_pool
    # ARQ pickles job payloads; a decoding pool would corrupt them.
    assert arq_pool.connection_kwargs.get("decode_responses", False) is False
    assert plain_pool.connection_kwargs["decode_responses"] is True


def test_arq_pool_follows_the_configured_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "redis_url", "redis://redis-elsewhere:6380/3")

    kwargs = redis_module.get_arq_client().connection_pool.connection_kwargs

    assert kwargs["host"] == "redis-elsewhere"
    assert kwargs["port"] == 6380
    assert kwargs["db"] == 3


@_asyncio_test
async def test_arq_dependency_resolves_without_connecting(
    monkeypatch: pytest.MonkeyPatch, _no_connect: None
) -> None:
    """An unreachable Redis must not cost the request a connect-retry loop.

    ``.invalid`` never resolves, so resolving this dependency through
    ``arq.create_pool`` would block on ``ping`` and its retry-and-sleep loop --
    seconds per request, and a host-run test hang against a container hostname.
    """
    monkeypatch.setattr(settings, "redis_url", "redis://unreachable.invalid:6379")

    generator = redis_module.get_arq_redis()
    client = await anext(generator)
    try:
        assert isinstance(client, ArqRedis)
        assert client.connection_pool is redis_module._get_arq_pool()
    finally:
        await generator.aclose()


@_asyncio_test
async def test_arq_dependency_closing_leaves_the_shared_pool_usable(
    _no_connect: None,
) -> None:
    pool = redis_module._get_arq_pool()

    generator = redis_module.get_arq_redis()
    await anext(generator)
    await generator.aclose()

    assert redis_module.get_arq_client().connection_pool is pool
