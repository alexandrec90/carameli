"""Every ``/vsapi/1.0.0`` route exists, binds the .NET payload, and enforces auth.

``/vsapi`` is the tree VanillaSoft's .NET clients call — ``CloudliClient.cs`` and
``CarameliClient.cs`` under ``AppCode/VanillaSoft.Backend/``. It is also the tree where a
break is least visible from here: nothing in Carameli's own frontend touches it, so a
route that starts 404ing or stops accepting a payload shape is discovered by a support
ticket rather than by a test.

This module is the floor under all of it. Every route in
``tests/local_e2e/vsapi_manifest.py`` gets, over real HTTP:

- **auth** — a missing bearer and a wrong bearer are both 401;
- **payload contract** — the authenticated shape that must be rejected, and the status it
  must be rejected with, per :func:`vsapi_manifest.expected_contract_status`;
- **error shape** — failures come back as FastAPI's ``{"detail": ...}``, which is what
  ``CarameliClient`` parses to build its ``CMVApiResponse.Message``.

None of these probes can reach a provider: each is rejected at auth, at customer scope,
or at body validation, all of which run before the handler's first outbound call. The
success paths — which *can* — live in the sibling modules and only ever cover routes the
manifest classifies as :data:`~vsapi_manifest.DB`.

:func:`test_every_openapi_route_is_in_the_manifest` is the guard that keeps this honest:
it reads the running app's ``/openapi.json``, so a route added to ``app/api/vsapi/``
fails this suite until someone classifies it and decides what coverage it gets.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio

from tests.local_e2e import vsapi_manifest as manifest
from tests.local_e2e.helpers import NGROK_SKIP_HEADER, LocalE2EConfig, describe
from tests.local_e2e.vsapi_manifest import ROUTES, Route, route_id

pytestmark = pytest.mark.asyncio(loop_scope="session")

# Long enough for a cold route, short enough that a hung request fails the test rather
# than the whole session's pytest-timeout budget.
PROBE_TIMEOUT_S = 20.0


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def probe_client() -> AsyncIterator[httpx.AsyncClient]:
    """One pooled client for every probe in this module.

    Four probes per route across ~79 routes is a few hundred requests, and a client per
    request spends most of the module's wall clock on TCP setup it immediately discards.
    Session-scoped rather than per-test for that reason, which is safe here because every
    probe is a single stateless request carrying its own headers.
    """
    async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_S) as client:
        yield client


def _url(config: LocalE2EConfig, route: Route) -> str:
    return f"{config.carameli_base_url}{manifest.VSAPI_PREFIX}{route.concrete()}"


async def _request(
    client: httpx.AsyncClient,
    config: LocalE2EConfig,
    route: Route,
    *,
    bearer: str | None,
    body: dict[str, object] | None,
) -> httpx.Response:
    """Issue one probe. ``bearer=None`` omits the header entirely."""
    headers = dict(NGROK_SKIP_HEADER)
    if bearer is not None:
        headers["Authorization"] = f"Bearer {bearer}"
    return await client.request(
        route.method,
        _url(config, route),
        headers=headers,
        json=body if route.has_body else None,
    )


# --------------------------------------------------------------------------------------
# completeness
# --------------------------------------------------------------------------------------


async def test_every_openapi_route_is_in_the_manifest(
    config: LocalE2EConfig, probe_client: httpx.AsyncClient
) -> None:
    """A new ``/vsapi`` route fails this suite until it is classified and covered.

    Read from the *running* app rather than from the source tree, because that is the
    thing the .NET clients talk to: a route that exists in a module but is not mounted on
    the router is exactly the failure this suite is for, and a static scan would miss it.
    """
    response = await probe_client.get(
        f"{config.carameli_base_url}/openapi.json", headers=NGROK_SKIP_HEADER
    )
    assert response.status_code == 200, f"could not read the OpenAPI schema: {describe(response)}"

    served: set[tuple[str, str]] = set()
    for path, item in response.json()["paths"].items():
        if not path.startswith(manifest.VSAPI_PREFIX + "/"):
            continue
        for method in item:
            if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                served.add((method.upper(), path))

    covered = manifest.covered_operations()
    uncovered = sorted(served - covered)
    assert not uncovered, (
        "these /vsapi routes are served but absent from tests/local_e2e/vsapi_manifest.py, "
        "so nothing checks that VanillaSoft can still call them. Add each to ROUTES with "
        "its coverage class — DB (success-path) or EXTERNAL (contract-only, with the "
        f"provider call named in `why`): {uncovered}"
    )

    stale = sorted(covered - served)
    assert not stale, (
        "the manifest claims routes the running app does not serve. Either they were "
        "renamed — in which case every .NET caller is now getting 404 — or the manifest "
        f"is stale: {stale}"
    )


async def test_the_manifest_classifies_every_route(config: LocalE2EConfig) -> None:
    """Every entry has a coverage class and every EXTERNAL one says what it would call.

    An ``EXTERNAL`` route with no ``why`` is the dangerous state: the next reader cannot
    tell whether it is contract-only for a real reason or because someone did not get to
    it, and "I'll just try the success path" is how this suite sends an SMS.
    """
    for route in ROUTES:
        assert route.kind in {manifest.DB, manifest.EXTERNAL}, (
            f"{route.method} {route.path} has no coverage class"
        )
        if route.kind == manifest.EXTERNAL:
            assert route.why, (
                f"{route.method} {route.path} is contract-only but does not name the "
                "provider call it would make — say which one, so a future reader can "
                "tell a real constraint from an unfinished test"
            )


# --------------------------------------------------------------------------------------
# authentication
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("route", ROUTES, ids=route_id)
async def test_route_requires_a_bearer_token(
    config: LocalE2EConfig, probe_client: httpx.AsyncClient, route: Route
) -> None:
    """No ``Authorization`` header at all is 401, on every route in the tree.

    This is the one probe that is safe on *every* route including the provider-touching
    ones, because authentication is the outermost layer: nothing downstream of it runs.
    It is also the test that proves the route is mounted — a 404 here means VanillaSoft's
    client is talking to a path Carameli no longer serves.
    """
    response = await _request(probe_client, config, route, bearer=None, body={})

    assert response.status_code != 404, (
        f"{route.method} {route.path} is not served by Carameli, but "
        f"{route.caller or 'the /vsapi contract'} expects it. {describe(response)}"
    )
    assert response.status_code == 401, (
        f"{route.method} {route.path} did not reject an unauthenticated request. "
        f"{describe(response)}"
    )


@pytest.mark.parametrize("route", ROUTES, ids=route_id)
async def test_route_rejects_a_wrong_bearer_token(
    config: LocalE2EConfig, probe_client: httpx.AsyncClient, route: Route
) -> None:
    """A syntactically valid but unknown key is 401, never 403 and never a success.

    Distinct from the missing-header case on purpose: a route that checks *presence* but
    not *value* passes the test above while accepting anyone's key.
    """
    response = await _request(
        probe_client, config, route, bearer="not-a-real-carameli-api-key", body={}
    )

    assert response.status_code == 401, (
        f"{route.method} {route.path} accepted an unknown API key — it is checking that a "
        f"bearer header exists, not that it is valid. {describe(response)}"
    )


# --------------------------------------------------------------------------------------
# payload contract
# --------------------------------------------------------------------------------------

_PROBED = tuple(route for route in ROUTES if route.authenticated_probe)


@pytest.mark.parametrize("route", _PROBED, ids=route_id)
async def test_route_enforces_its_payload_contract(
    config: LocalE2EConfig, probe_client: httpx.AsyncClient, route: Route
) -> None:
    """The authenticated rejection shape, which also proves the route binds a payload.

    What is asserted per route comes from
    :func:`vsapi_manifest.expected_contract_status`; read its docstring for why the
    ordering (scope before body) is what makes this safe to run against routes whose
    success path would place a call or send a message.

    A 200 here is the alarming outcome, not merely a wrong status: it would mean an
    unknown customer id or an empty body was *accepted*.
    """
    expected = manifest.expected_contract_status(route)
    assert expected is not None  # guarded by the _PROBED filter

    response = await _request(probe_client, config, route, bearer=config.carameli_api_key, body={})

    assert response.status_code < 500, (
        f"{route.method} {route.path} answered a malformed/unknown-customer request with "
        f"a server error instead of rejecting it. {describe(response)}"
    )
    assert response.status_code == expected, (
        f"{route.method} {route.path} was expected to reject this probe with {expected}. "
        "If the route legitimately changed, update expected_contract_status() rather than "
        f"this assertion — the .NET client branches on these statuses. {describe(response)}"
    )


@pytest.mark.parametrize("route", _PROBED, ids=route_id)
async def test_rejections_use_the_fastapi_detail_shape(
    config: LocalE2EConfig, probe_client: httpx.AsyncClient, route: Route
) -> None:
    """Errors carry ``{"detail": ...}``, which is what ``CarameliClient`` parses.

    ``CarameliClient`` reads ``detail`` out of the body to populate
    ``CMVApiResponse.Message``; a rejection that returned a bare string or a differently
    keyed object would surface to a VanillaSoft user as an empty error message, which is
    the least debuggable failure this integration can produce.
    """
    response = await _request(probe_client, config, route, bearer=config.carameli_api_key, body={})

    assert "json" in response.headers.get("content-type", "").lower(), (
        f"{route.method} {route.path} returned a non-JSON error body. {describe(response)}"
    )
    payload = response.json()
    assert isinstance(payload, dict) and "detail" in payload, (
        f"{route.method} {route.path} returned an error body with no 'detail' key, so "
        f"CarameliClient would surface an empty message. {describe(response)}"
    )
