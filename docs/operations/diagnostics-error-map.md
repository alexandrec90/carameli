# Diagnostics: where every integration error lands

You are here because "something didn't work" in the Carameli ⇄ VanillaSoft integration.
This doc maps each failure mode to the evidence it leaves and what to grep or query. It
assumes the "airtight error visibility" work
(phases 01–05, `docs/plans/active/airtight-vanillasoft/`)
is deployed: notify failures carry VanillaSoft's real error body, VanillaSoft-side
errors ship into Carameli's log, and a reconciliation cron catches webhooks that never
arrived.

Everything backend lands in **`logs/runtime/carameli.log`** (rotating, 10 MB × 5). The
log format is machine-parseable:

```text
2026-07-07 10:00:01.200 | ERROR    | app.services.vanillasoft_notify:159 | VanillaSoft notify POST returned 500 path=IncomingCall ref=CA123 body=...
```

Fields: `timestamp.ms | LEVEL | module:lineno | message`.

## 1. The map — failure mode → evidence → what to run

| Failure mode | Where the evidence is | What to grep / query |
| --- | --- | --- |
| Carameli 500 (any handler) | Global exception handler → `carameli.log` | `grep -E "\| (ERROR\|CRITICAL) " logs/runtime/carameli.log` |
| Provider (Telnyx/Jambonz) error in a handler | `carameli.log` ERROR with `vs_customer_id` + target number | `grep "Provider error" logs/runtime/carameli.log` |
| Notify **rejected** by VanillaSoft (4xx) | `carameli.log` **WARNING** with status + response body (phase 01) | `grep "notify POST returned" logs/runtime/carameli.log` |
| Notify **failed** on VS side (5xx) | `carameli.log` **ERROR** with status + honest error body (phase 01 + 02) | `grep "notify POST returned 5" logs/runtime/carameli.log` |
| Notify never left Carameli (network/timeout) | `carameli.log` ERROR `notify POST failed` (exception) | `grep "notify POST failed" logs/runtime/carameli.log` |
| VS-internal / client-side error (outside an HTTP exchange Carameli sees) | Shipped via phase 03 NLog → `POST /webhooks/vs-log` → `carameli.log` under `vs.Carameli.*` | `grep "vs.Carameli." logs/runtime/carameli.log` |
| Webhook never arrived (ngrok down, laptop asleep) | Reconciliation cron ERROR (phase 04) | `grep "Reconciliation:" logs/runtime/carameli.log` |
| Unposted backlog (event stuck, retry not draining) | `call_events.posted=false` / `sms_messages.posted=false` older than a few minutes | see the SQL below (`mcp__postgres__query`) |
| Successful delivery (the airtight "landed" signal) | `carameli.log` INFO `notify POST ok path=...` | `grep "notify POST ok" logs/runtime/carameli.log` |

Unposted-backlog query (run via `mcp__postgres__query`):

```sql
SELECT call_sid, status, created_at
FROM call_events
WHERE posted = false AND created_at < now() - interval '5 minutes'
ORDER BY created_at DESC
LIMIT 50;
-- and the SMS side:
SELECT message_sid, direction, delivery_status, created_at
FROM sms_messages
WHERE posted = false AND created_at < now() - interval '5 minutes'
ORDER BY created_at DESC
LIMIT 50;
```

A non-empty result older than the 30 s retry window means the retry cron is not
draining — check for a `notify POST returned`/`failed` ERROR for the same `ref`.

## 2. The ngrok inspector (in-memory request/response log)

ngrok records every tunneled request+response at a local API. State is **in-memory and
lost on tunnel restart**.

Did jambonz/Telnyx call us in the last little while, and what did we answer:

```bash
# Recent tunneled requests (JSON)
curl -s "http://127.0.0.1:4040/api/requests/http?limit=50" | jq '.requests[] | {id, method: .request.method, uri: .request.uri, status: .response.status_code, at: .start}'

# Just the jambonz call-status posts
curl -s "http://127.0.0.1:4040/api/requests/http?limit=50" | jq '.requests[] | select(.request.uri | test("call-status"))'

# Full detail (request + response body) for one request id
curl -s "http://127.0.0.1:4040/api/requests/http/<id>" | jq '.'
```

Replay a captured request (**mutating** — re-delivers the webhook to Carameli; ask
before doing this, it can double-write):

```bash
curl -X POST "http://127.0.0.1:4040/api/requests/http/<id>/replay"
```

## 3. Correlation recipe — follow one call across every system

A single call's `call_sid` is the join key across the whole chain:

```text
jambonz portal (RecentCalls)  ─ call_sid ─►  ngrok inspector (/api/requests/http)
        │                                            │
        └────────────► carameli.log ◄────────────────┘   grep the call_sid
                              │
                     call_events.call_sid  ── (notify) ──►  VS notify/IncomingCall "callId"
                              │
                     (staging) sp_CMVCallNotificationInsert rows
```

Concretely, given a `call_sid`:

1. `grep <call_sid> logs/runtime/carameli.log` — every stage Carameli logged.
2. `curl -s "http://127.0.0.1:4040/api/requests/http?limit=100" | jq '... | select(test("<call_sid>"))'` — the raw webhook + our answer.
3. `mcp__postgres__query`: `SELECT * FROM call_events WHERE call_sid = '<call_sid>';` — the local row and its `posted` flag.
4. VanillaSoft staging: look for `notify/IncomingCall` with matching `callId`, then the
   `sp_CMVCallNotificationInsert` rows.

For SMS the same recipe uses `message_sid` (Telnyx id) ↔ `sms_messages.message_sid` ↔ VS
`referenceId`.

## 4. Manual drills

**ngrok-outage drill** (proves phase 04 is the net under a dropped tunnel):

1. Turn on the reconciliation cron (`RECONCILIATION_ENABLED=true`) in the live env.
2. Kill ngrok (`pkill ngrok` or stop the tunnel process).
3. Place a test call A→B (or send an SMS) — the provider records it; the webhook has
   nowhere to land.
4. Restart ngrok.
5. Wait one reconciliation interval (cron runs every 10 min). Expect a
   `Reconciliation: provider call <sid> ... has no call_events row` ERROR.
6. **Recovery**: provider-side webhook retries may still deliver late; otherwise use the
   ngrok inspector replay (§2) or accept the gap — reconciliation only *detects*, it
   never backfills (a synthesized row would mask that delivery broke).

## 5. Running the live E2E suite

Opt-in, real money (cents/run: call minutes + SMS), never in CI. Backend only.

```bash
RUN_LIVE_E2E=1 pytest tests/live_e2e -m live_e2e
```

Run **one module at a time** on the first live run and watch `carameli.log`:

```bash
RUN_LIVE_E2E=1 pytest tests/live_e2e/test_live_sms.py -m live_e2e -s
```

Attended click-to-call (answer the phone) adds the `manual` marker:

```bash
RUN_LIVE_E2E=1 pytest tests/live_e2e -m "live_e2e and manual"
```

Collection sanity check (no env needed — proves the suite imports cleanly and skips):

```bash
pytest tests/live_e2e -m live_e2e --collect-only
```

### Environment contract

| Var | Meaning |
| --- | --- |
| `RUN_LIVE_E2E` | `1` to enable the suite |
| `E2E_BASE_URL` | Carameli public base (ngrok URL) or `http://localhost:8000` |
| `E2E_API_KEY` | Bearer key for a dedicated E2E test customer |
| `E2E_CUSTOMER_ID` | That customer's `vs_customer_id` (for `/List/{id}` reads) |
| `E2E_DID_A`, `E2E_DID_B` | Two owned Canadian test DIDs; B is the inbound target |
| `E2E_VS_CHECK` | optional `1`: also assert VanillaSoft-side via PubApi |
| `E2E_TELNYX_CONNECTION_ID` | optional: Telnyx Call Control connection for unattended calls |
| `E2E_EXTENSION` | optional: extension for the attended `manual` variant |
| `E2E_RECORDING` | optional `1`: run the recording flow (roadmap A6 must be live) |

Every flow asserts *at minimum*: the expected row appears via Carameli's API, and — the
airtight part — the event reaches VanillaSoft durably. For calls that is `posted=True`
on the row; for SMS (where `posted` is not exposed on the API) it is the
`notify POST ok` log line. With the honest receiver, both **mean** VanillaSoft
processed and persisted the event.
