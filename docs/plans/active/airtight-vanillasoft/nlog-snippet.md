# NLog config snippet — ship `Carameli.*` logs to Carameli (`/webhooks/vs-log`)

Human deliverable for **phase 03**. Apply this to the staging `NLog.config` of
`VanillaSoft.VoipApi` (and any other host whose Carameli client traffic you want to
capture — see "Which hosts" below). It is **additive**: the new rule uses `final="false"`
so all existing local file/console targets keep logging unchanged.

The endpoint authenticates with the same shared secret as the notify direction
(`X-Cloudli-Auth` == Carameli's `VANILLASOFT_WEBHOOK_SECRET` == staging's
`CloudliAuthValue` appSetting). No new secret.

## Snippet

Set `url` to the current ngrok domain before applying. Keep `minlevel="Warn"` so the
volume stays trivial.

```xml
<!-- inside <targets> -->
<target xsi:type="BufferingWrapper" name="carameliShip" bufferSize="50"
        flushTimeout="5000" overflowAction="Flush">
  <target xsi:type="WebService" name="carameliShipInner"
          url="https://YOUR-NGROK-DOMAIN.ngrok-free.app/webhooks/vs-log"
          protocol="JsonPost" encoding="utf-8">
    <header name="X-Cloudli-Auth" layout="${appsetting:item=CloudliAuthValue}" />
    <parameter name="time"      type="System.String" layout="${longdate}" />
    <parameter name="level"     type="System.String" layout="${level:upperCase=true}" />
    <parameter name="logger"    type="System.String" layout="${logger}" />
    <parameter name="message"   type="System.String" layout="${message}" />
    <parameter name="exception" type="System.String" layout="${exception:format=ToString}" />
    <parameter name="machine"   type="System.String" layout="${machinename}" />
    <parameter name="auth"      type="System.String" layout="${appsetting:item=CloudliAuthValue}" />
  </target>
</target>

<!-- inside <rules>, BEFORE the catch-all rule, final="false" so local file logging keeps working -->
<logger name="Carameli.*" minlevel="Warn" writeTo="carameliShip" final="false" />
```

## Caveats (verify against VoipApi's `packages.config` before applying)

- **NLog version.** `<header>` on a `WebService` target needs **NLog ≥ 4.6.5**; the
  `${appsetting}` layout renderer needs **NLog ≥ 4.6** (or the `NLog.AppSettings` package on
  older builds). If staging runs an older NLog, **drop the `<header>` line** — the endpoint
  still authenticates via the `auth` **body parameter**, which duplicates the same secret.
  Carameli accepts the secret from either the header or the body's `auth` field.
- **Additive only.** The new `<logger>` rule is `final="false"`, so records matching
  `Carameli.*` still flow to every existing rule/target. Place it *before* the catch-all
  rule but do not remove or reorder existing rules.
- **Carameli down.** If staging can't reach the ngrok URL, `BufferingWrapper`
  (`overflowAction="Flush"`) absorbs short gaps and drops on overflow. Acceptable: when
  Carameli is down its own side already fails loudly (unposted `call_events` / `sms_messages`
  rows pile up and the 30 s retry crons log).

## Which hosts

The receiver path runs in `VanillaSoft.VoipApi` (which owns `NLog.config`); the client
path (`CarameliClient` / `CarameliService`) runs in whichever host resolved
`ICloudliService` via `CloudliServiceFactory` — PubApi, Webservice, NotificationService,
Task Service, SMSDripService, VoipLineCountUpdate, VoipApi. Shipping from VoipApi
alone covers the receiver plus its own client calls. Apply the same snippet to another
host's NLog config only when that host's Carameli traffic actually matters.

## Field mapping

The parameter names above line up 1:1 with `app/schemas/vs_log.py` (`VsLogEntry`) and the
handler in `app/api/webhooks/vs_log.py`:

| NLog parameter | `VsLogEntry` field | Handler use |
| --- | --- | --- |
| `time` | `time` | carried, not currently re-emitted |
| `level` | `level` | mapped to a Python level (`WARN`→`WARNING`, unknown→`WARNING`) |
| `logger` | `logger` | re-emitted under `vs.<logger>` (grep for `\| vs.`) |
| `message` | `message` | truncated to 2000 chars |
| `exception` | `exception` | truncated to 4000 chars, appended as `\| exception=…` |
| `machine` | `machine` | rendered as `[staging <machine>]` |
| `auth` | `auth` | fallback shared secret; never logged |

## Staging smoke (phase 03 Part D)

After deploy + config: temporarily break `CarameliApiBaseUrl`, make one Carameli-path
client call, and confirm an entry appears in `logs/runtime/carameli.log` as
`| vs.Carameli.Client |` within seconds. Revert the setting.
