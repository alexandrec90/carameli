# Phase 03 — CRM → Carameli log shipping (`/webhooks/vs-log`)

> Read `00-overview.md` first. Covers the residual channel the honest receiver (phase 02)
> can't: CRM-side errors that never become an HTTP response Carameli sees —
> exceptions inside `CarameliClient`/`CarameliService` (the VS→Carameli call direction),
> plus anything still asynchronous on staging. Three parts: a Carameli ingest endpoint,
> Carameli-scoped NLog logger names in LegacyCRM, and the exact `NLog.config` XML as a
> human deliverable for staging. No new pip dependencies.

## Part A — Carameli: `POST /webhooks/vs-log`

New handler `app/api/webhooks/vs_log.py`, registered like the existing webhook routers
(see `app/api/webhooks/__init__.py` and mirror `sms_inbound.py`'s structure; the webhook
rule `.claude/rules/webhooks.md` applies).

- **Auth**: compare header `X-Log-Auth` to `settings.crm_webhook_secret`
  (constant-time compare via `hmac.compare_digest`). Mismatch → 403. Secret unconfigured →
  skip validation (established dev/CI convention). No customer scoping — this is a
  server-to-server diagnostics channel, like the other webhooks.
- **Schema** (Pydantic, in `app/schemas/` per repo layout): one JSON object per request —
  that's how NLog's WebService target posts. Fields (match the NLog parameters in Part C):
  `time: str`, `level: str`, `logger: str`, `message: str`,
  `exception: str | None = None`, `machine: str | None = None`, and
  `auth: str | None = None` (fallback credential — see the NLog version caveat in Part C;
  accept the secret from *either* the header or this body field).
- **Behavior**: truncate `message`/`exception` server-side (reuse/mirror phase 01's
  `_truncate`, ~4000 chars for exceptions), map the NLog level string to a Python level
  (`WARN`→`WARNING`, unknown→`WARNING`), then emit into the normal logging tree under a
  `vs.`-prefixed logger so entries are grep-distinguishable in `carameli.log`:

  ```python
  logging.getLogger("vs." + entry.logger).log(
      level, "[staging %s] %s%s", entry.machine or "?", message, exception_suffix
  )
  ```

  (Lazy `%s` args, never f-strings. The `vs.` prefix is the contract — the diagnostics doc
  in phase 05 tells agents to grep for `| vs.`.) Everything still lands in
  `logs/runtime/carameli.log` — no new log file (hard rule).
- **Response**: 204 on success, 400 on schema failure, 403 on bad secret. Returning 4xx/5xx
  is safe — NLog drops or buffers, it doesn't retry-storm.
- **Do not** write these to the database. Log-only channel; keep it dumb.

### Tests (same commit) — `tests/unit/test_vs_log_webhook.py`

Follow the existing webhook-test patterns in `tests/unit/` (see the sms_inbound tests for
app/client fixtures): happy path → 204 + `caplog` shows the record under `vs.<logger>` at
the mapped level with the machine tag; wrong secret → 403; secret via `auth` body field
(no header) → accepted; secret unconfigured → accepted (dev mode); bad payload → 400;
oversized message/exception → truncated marker present; unknown level string → WARNING.

## Part B — LegacyCRM: Carameli-scoped logger names

Decoupling requirement: NLog routing must be able to select **only Carameli traffic**.

1. Inspect what `Logger.Log` actually is in the classes under
   `AppCode/<legacy-backend>/Carameli/` and in `the legacy notify controller` (shared static
   wrapper? NLog-backed? log4net?). Don't assume.
2. If NLog-backed: give every Carameli class its own named logger, prefix `Carameli.` —
   e.g. `private static readonly NLog.Logger Log = NLog.LogManager.GetLogger("Carameli.Client");`
   in `CarameliClient`, `Carameli.Service` in `CarameliService`,
   `Carameli.NotifyController` in the phase-02 controller. Replace the `Logger.Log.*`
   calls inside the Carameli folder (and only there).
3. If it's a custom/log4net wrapper: add a small `CarameliLog` static class *inside the
   Carameli folder* that writes to NLog with `Carameli.*` names, and switch the Carameli
   classes to it. Touch nothing outside the Carameli folder either way.
4. Also make sure `CarameliClient` **catches-and-logs** (then rethrows) around its HTTP
   calls so a connection failure to Carameli produces a `Carameli.*` Error entry — today
   most of its logging is `Info` status lines; check the `catch` blocks (~line 433 area)
   actually log through the Carameli logger.
5. MSTest where practical (logger-name constants, wrapper behavior); logging plumbing that
   Moq can't reach gets covered by the staging smoke in Part D. No local .NET build —
   CI verifies compilation.

Which hosts matter: the receiver path runs in `CRM VoIP API` (has `NLog.config`);
the client path runs in the hosts that resolve `legacy VoIP service interface` via `legacy VoIP service factory`
(PubApi, Webservice, NotificationService, Task Service, SMSDripService, VoipLineCountUpdate,
VoipApi). Shipping from VoipApi alone covers the receiver + its own client calls;
apply the same config snippet to other hosts' NLog configs only if/when their Carameli
traffic matters (note this in the PR body rather than boiling the ocean).

## Part C — Deliverable: `NLog.config` snippet for staging (human applies)

Produce this as a fenced block in the PR/commit body and in a short
`docs/plans/active/airtight-crm/nlog-snippet.md` alongside the plan. Template (adjust
`url` to the real ngrok domain; keep `minlevel="Warn"` so volume stays trivial):

```xml
<!-- inside <targets> -->
<target xsi:type="BufferingWrapper" name="carameliShip" bufferSize="50"
        flushTimeout="5000" overflowAction="Flush">
  <target xsi:type="WebService" name="carameliShipInner"
          url="https://YOUR-NGROK-DOMAIN.ngrok-free.app/webhooks/vs-log"
          protocol="JsonPost" encoding="utf-8">
    <header name="X-Log-Auth" layout="${appsetting:item=legacy shared-secret appSetting}" />
    <parameter name="time"      type="System.String" layout="${longdate}" />
    <parameter name="level"     type="System.String" layout="${level:upperCase=true}" />
    <parameter name="logger"    type="System.String" layout="${logger}" />
    <parameter name="message"   type="System.String" layout="${message}" />
    <parameter name="exception" type="System.String" layout="${exception:format=ToString}" />
    <parameter name="machine"   type="System.String" layout="${machinename}" />
    <parameter name="auth"      type="System.String" layout="${appsetting:item=legacy shared-secret appSetting}" />
  </target>
</target>

<!-- inside <rules>, BEFORE the catch-all rule, final="false" so local file logging keeps working -->
<logger name="Carameli.*" minlevel="Warn" writeTo="carameliShip" final="false" />
```

Caveats to verify while writing the snippet (check `packages.config` in VoipApi):

- `<header>` on the WebService target needs **NLog ≥ 4.6.5**; `${appsetting}` needs NLog ≥
  4.6 (or `NLog.AppSettings` package on older). That's why the `auth` **body parameter**
  duplicates the secret — on an old NLog, drop the `<header>` line and the endpoint still
  authenticates via the body field.
- The existing local NLog targets/rules must keep working — the new rule is additive,
  `final="false"`.
- If staging can't reach the ngrok URL when Carameli is down, `BufferingWrapper` absorbs
  short gaps and drops on overflow — acceptable: when Carameli is down, its own side is
  already failing loudly (unposted rows piling up).

## Part D — Staging smoke (human, record results)

After deploy + config: trigger a Carameli-path warning (e.g. temporarily break
`CarameliApiBaseUrl`, make one client call) → the entry appears in `carameli.log` as
`| vs.Carameli.Client |` within seconds. Revert the setting.

## Verify (Carameli side)

```sh
pytest tests/unit/test_vs_log_webhook.py
ruff check app/api/webhooks/vs_log.py app/schemas/<new schema file> tests/unit/test_vs_log_webhook.py
mypy app/api/webhooks/vs_log.py
```
