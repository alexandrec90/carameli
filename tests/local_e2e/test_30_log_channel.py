"""The diagnostics channels — can an agent on this machine actually read both sides?

The airtight-visibility work assumes a coding agent can see every error on either side of
the integration. In the inverted topology that assumption needs re-proving, because the
two log sinks moved:

- **Carameli's own log** lives on the remote box, unreadable from here. The bridge is
  ``POST /webhooks/vs-log``, which accepts a VanillaSoft-side record and re-emits it into
  ``carameli.log`` — tested here for reachability and authentication.
- **VanillaSoft's log** is shipped by NLog into the *local* Elasticsearch. That is the
  channel an agent on this machine actually greps, so this module proves a log line
  written by the receiver during a request really becomes a searchable document.

A silent break in either channel does not fail any other test — it just makes the next
failure undiagnosable. Hence testing the instrumentation itself.
"""

from __future__ import annotations

import uuid

import httpx
import pytest

from tests.local_e2e.helpers import (
    NGROK_SKIP_HEADER,
    LocalE2EConfig,
    describe,
    es_search,
    hits_of,
    incoming_call_payload,
    nlog_record,
    poll_until,
    post_notify,
    synthetic_call_id,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

# How long NLog's async ElasticSearch target may take to flush and ES to refresh before
# the document is searchable. Generous on purpose: a flaky log assertion is worse than a
# slow one, and this suite is free to run.
LOG_VISIBILITY_TIMEOUT_S = 90.0

# pytest.ini sets a global `timeout = 60` with `timeout_method = thread`. That is shorter
# than the poll above, and a thread-method timeout *kills* the test rather than failing
# it — the result never gets reported, so the test silently disappears from the run
# instead of telling you the log channel is down. The per-test budget must therefore
# exceed the poll budget with room to spare.
LOG_TEST_TIMEOUT_S = int(LOG_VISIBILITY_TIMEOUT_S) + 30


async def test_vs_log_webhook_rejects_a_wrong_secret(config: LocalE2EConfig) -> None:
    """``/webhooks/vs-log`` on the remote must reject an unauthenticated record.

    A 403 here is also the positive signal that ``VANILLASOFT_WEBHOOK_SECRET`` is
    configured on the remote at all: with no secret set, the endpoint drops into dev mode
    and accepts anything, which would make the next test pass for the wrong reason.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{config.carameli_base_url}/webhooks/vs-log",
            json=nlog_record(level="ERROR", message="local-e2e auth probe"),
            headers={"X-Cloudli-Auth": "definitely-not-the-secret", **NGROK_SKIP_HEADER},
        )

    assert response.status_code == 403, (
        "the remote /webhooks/vs-log accepted a wrong shared secret. If this is a 204, "
        "VANILLASOFT_WEBHOOK_SECRET is unset on the remote and the endpoint is running "
        f"in dev mode. {describe(response)}"
    )


async def test_vs_log_webhook_accepts_a_valid_record(config: LocalE2EConfig) -> None:
    """A correctly authenticated VanillaSoft log record is ingested with 204.

    This is the escape hatch for VanillaSoft-side errors that never surface as an HTTP
    response Carameli sees — exceptions inside ``CarameliClient``/``CarameliService``.
    Skips when the secret is not configured locally; without it there is nothing to test.

    The body goes through :func:`nlog_record` rather than being hand-written here. A
    hand-written one omitted ``time`` and this test failed with 422 for months against a
    perfectly healthy channel — ``VsLogEntry.time`` is required and ``${longdate}`` is
    always present in a real record, so the defect was in the probe, never the schema.
    """
    if not config.vs_webhook_secret:
        pytest.skip("VS_WEBHOOK_SECRET not set — cannot exercise /webhooks/vs-log ingestion")

    marker = f"local-e2e probe {uuid.uuid4()}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{config.carameli_base_url}/webhooks/vs-log",
            json=nlog_record(message=marker),
            headers={"X-Cloudli-Auth": config.vs_webhook_secret, **NGROK_SKIP_HEADER},
        )

    assert response.status_code == 204, (
        "the remote /webhooks/vs-log rejected a correctly authenticated record — "
        "VS_WEBHOOK_SECRET does not match the remote's VANILLASOFT_WEBHOOK_SECRET. "
        f"{describe(response)}"
    )


@pytest.mark.timeout(LOG_TEST_TIMEOUT_S)
async def test_vanillasoft_logs_reach_local_elasticsearch(config: LocalE2EConfig) -> None:
    """A log line written by the receiver during a request becomes searchable locally.

    ``CarameliNotifyController`` logs ``Carameli NotifyIncomingCall received uuid=<id>``
    on entry, so posting a notify with a unique id and then finding that id in
    Elasticsearch proves the whole chain: IIS -> NLog -> ElasticSearch target -> local
    index. Without this chain there is no way to see VanillaSoft-side errors from this
    machine.

    Uses an intentionally unmappable ``eventName`` so the request is a cheap 400 that
    writes no database row — the log line is emitted before that check.
    """
    marker = synthetic_call_id()
    payload = incoming_call_payload(
        call_sid=marker,
        vs_customer_id=config.vs_customer_id,
        from_number="+15145550100",
        to_number="+15145550101",
        event_name="callTeleported",
    )
    response = await post_notify(
        config.vs_local_base_url, "IncomingCall", payload, config.notify_secret
    )
    assert response.status_code == 400, f"expected the cheap 400 path: {describe(response)}"

    async def find_marker() -> list[dict[str, object]]:
        try:
            result = await es_search(
                config.es_url,
                config.es_index,
                {"query": {"match_phrase": {"message": marker}}, "size": 5},
            )
        except httpx.HTTPStatusError as exc:
            # A missing index is the expected state before the first document ever
            # arrives; treat it as "not yet" so the poll reports the useful timeout.
            if exc.response.status_code == 404:
                return []
            raise
        return hits_of(result)

    try:
        hits = await poll_until(
            find_marker,
            timeout_s=LOG_VISIBILITY_TIMEOUT_S,
            interval_s=5.0,
            description=f"NLog document containing {marker} in {config.es_index}",
        )
    except TimeoutError as exc:
        pytest.fail(
            "VanillaSoft log lines are not reaching local Elasticsearch, so an agent on "
            "this machine is blind to VanillaSoft-side errors. Check that "
            "NLog.Targets.ElasticSearch is present in the VoipApi bin directory, that "
            "NLog.config points at the local ES, and that the IIS app pool has recycled "
            f"since the config changed. {exc}"
        )

    assert hits, f"no document matched {marker}"
    document = hits[0]
    assert document.get("app") == "VoipApi", (
        "the log document is missing the 'app' field the NLog config adds, so log "
        f"records cannot be attributed to a source application: {document}"
    )
