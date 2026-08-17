# Local integration testing: remote Carameli ⇄ local VanillaLand

This is the runbook for the **inverted topology**: Carameli runs on a remote box exposed
through an ngrok tunnel, and VanillaLand runs locally in IIS on the developer machine.

That is the mirror image of the setup
[`docs/plans/active/airtight-vanillasoft/`](../plans/active/airtight-vanillasoft/00-overview.md)
was written for (Carameli local, VanillaSoft at staging). The consequences are not
cosmetic, so read this before reusing anything from those documents:

| Concern | Plan's topology | This topology |
| --- | --- | --- |
| Carameli's log | local file, tail it | remote — unreadable from here |
| VanillaSoft's log | remote staging NLog files | **local Elasticsearch**, greppable |
| Who needs a tunnel | Carameli (for provider webhooks) | **both** — Carameli for its API, VanillaLand so notifies can be delivered back |
| Test suite | `tests/live_e2e/`, costs real money | `tests/local_e2e/`, free |

`tests/live_e2e/` is **not** the suite for this setup: it tails `logs/runtime/carameli.log`
on the local box (now the wrong box) and spends real Telnyx/jambonz money. Use
`tests/local_e2e/`.

## The suite

```text
tests/local_e2e/
  helpers.py               config, HMAC signing, payload builders, ES + polling helpers
  test_00_preflight.py     is the plumbing up at all
  test_10_vs_to_carameli.py    VanillaLand -> Carameli contract (reads only)
  test_20_carameli_to_vs.py    Carameli -> VanillaLand honest receiver
  test_30_log_channel.py       can an agent here read either side's errors
```

It costs nothing — no call is placed and no message is sent — so it is deliberately **not**
marked `paid` and is safe to run in a loop. It is gated on `RUN_LOCAL_E2E=1` plus local
infrastructure instead, and excluded from the default collection in `pytest.ini`.

It also imports nothing from `app.*`. Carameli's Python stack is not installed on the
VanillaLand machine — no Postgres, no Redis, frequently no Python at all — so the suite
runs on stdlib plus `httpx`.

### Running it

```powershell
python scripts/run-local-e2e.py
```

The runner finds an interpreter (project `.venv` if present, otherwise an ephemeral `uv`
environment), applies the `--confcutdir` that keeps `tests/conftest.py` from being
imported, and writes failures to `logs/local-e2e-failures.log` with a fix hint per
failure. On a clean run it clears that artifact.

If you have no Python on PATH at all:

```powershell
uv run --python 3.12 --no-project scripts/run-local-e2e.py
```

Pass anything else straight through, e.g. `python scripts/run-local-e2e.py -k preflight`.

The pure helper logic is unit-tested in `tests/unit/test_local_e2e_helpers.py`, which
**does** run in CI. That file also pins the suite's signing implementation against
`app.services.vanillasoft_notify.sign_payload`, so the deliberate duplicate cannot drift.

## Setup

### 1. Local infrastructure

```powershell
docker start vanillasoft-sql vanillasoft-es
```

SQL Server holds the VanillaSoft database (`data source=localhost` in every
`Web.config`); Elasticsearch is where NLog ships VanillaSoft's logs. Both are ordinary
stopped containers after a reboot — a container that exited 137 was killed, usually by
Docker Desktop's memory limit.

IIS serves the site from the working tree, so there is nothing to deploy. The
`VanillaLand` site maps two aliases to the same VoIP receiver application
(`AppCode/VanillaSoft.VoipApi`):

| Alias | Use |
| --- | --- |
| `/voip` | Vendor-neutral, preferred. Carameli answers under `/voip/carameli/notify/*`, Cloudli under `/voip/notify/*` |
| `/cloudli` | Legacy, kept for back-compat with anything already pointing at it |

Both serve identical routes; they are separate IIS applications over one physical path.
The alias exists because Carameli is not a sub-part of Cloudli — the two vendors sit
side by side, and the URL should not imply otherwise. The receiver still lives inside the
`VanillaSoft.VoipApi` *project*, which shares its payload models
(`IncomingCall`/`SmsMessage`/`CallRecording`) and insert logic with `CloudliController`;
splitting the project would mean extracting those into a class library first, because Web
API discovers controllers in referenced assemblies and the two would collide on routes.

Confirm the branch's controller is actually built into it:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" -X POST http://localhost:8021/voip/carameli/notify/IncomingCall
```

The site-level rewrite rule in the root `web.config` ("Redirect / to /web") must exclude
each application alias, or requests get bounced to `/web`. `/voip` is listed there
alongside `/appt/` and `/cloudli/`.

`404` means the project is not built into the application at all.

`401` means a route is there — but **it does not prove the current build is running**, and
this is the trap worth knowing about. `CarameliNotifyController` was originally guarded by
`[CloudliHeaderAttribute]` (shared-secret header `X-Cloudli-Auth`) and only later moved to
`[CarameliSignature]` (HMAC `X-Carameli-Signature`). A stale binary rejects a correctly
*signed* notify with exactly the same 401 a wrong secret produces. Tell them apart by
offering the old header:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" -X POST -H "Content-Type: application/json" `
  -H "X-Cloudli-Auth: <CloudliAuthValue from Web.config>" -d "{}" `
  http://localhost:8021/voip/carameli/notify/IncomingCall
```

Anything other than 401 means the legacy filter is still in charge and the application is
running a build that predates the signature work — rebuild `VanillaSoft.VoipApi` and
recycle the app pool. Compare `bin/VanillaSoft.VoipApi.dll`'s timestamp against the
commit that added `BusinessLogic/Carameli/CarameliSignatureAttribute.cs` when in doubt.

### 2. Database schema

A database created before this branch lacks the VoIP-vendor routing objects, and
`VoipRoutingRepository` fails with `Invalid column name 'VoipVendor'` — which means no
customer can be routed to Carameli at all. The SSDT project
(`AppCode/VanillaSoft.Database`) already has both objects; this only applies them to an
older database. Idempotent:

```sql
IF COL_LENGTH('dbo.tblCustomer', 'VoipVendor') IS NULL
    ALTER TABLE dbo.tblCustomer ADD [VoipVendor] TINYINT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblCustomer_VoipVendor')
    ALTER TABLE dbo.tblCustomer ADD CONSTRAINT [CK_tblCustomer_VoipVendor]
        CHECK ([VoipVendor] IS NULL OR [VoipVendor] IN (0, 1, 2));
GO
IF OBJECT_ID('dbo.tblVoipLineVendor') IS NULL
BEGIN
    CREATE TABLE [dbo].[tblVoipLineVendor] (
        [CustomerID]             INT          NOT NULL,
        [PhoneNumberOrExtension] VARCHAR (50) NOT NULL,
        [Vendor]                 TINYINT      NOT NULL,
        [RequiredCapabilities]   INT          CONSTRAINT [DF_tblVoipLineVendor_RequiredCapabilities] DEFAULT ((0)) NOT NULL,
        [UpdatedUtc]             DATETIME2(0) CONSTRAINT [DF_tblVoipLineVendor_UpdatedUtc] DEFAULT (SYSUTCDATETIME()) NOT NULL,
        CONSTRAINT [PK_tblVoipLineVendor] PRIMARY KEY CLUSTERED ([CustomerID], [PhoneNumberOrExtension]),
        CONSTRAINT [FK_tblVoipLineVendor_tblCustomer] FOREIGN KEY ([CustomerID]) REFERENCES [dbo].[tblCustomer] ([CustomerID]),
        CONSTRAINT [CK_tblVoipLineVendor_Vendor] CHECK ([Vendor] IN (0, 1, 2)),
        CONSTRAINT [CK_tblVoipLineVendor_RequiredCapabilities] CHECK ([RequiredCapabilities] >= 0)
    );
    CREATE NONCLUSTERED INDEX [IX_tblVoipLineVendor_CustomerVendor]
        ON [dbo].[tblVoipLineVendor] ([CustomerID], [Vendor]);
END
GO
```

Route the test customer to Carameli (`VoipVendor` 0 = CMV, 1 = Cloudli, 2 = Carameli):

```sql
UPDATE dbo.tblCustomer SET VoipVendor = 2, CloudliEnabled = 0 WHERE CustomerID = @id;
```

`tblCMVCallNotification` has **no** foreign keys, so the notify tests insert successfully
even against a schema-only database with an empty `tblCustomer`. That covers the write
path but not the downstream contact-matching, which reports a benign post-insert skip
(still a 200). Seed a customer when you want that covered too.

### 3. The shared secrets

Three values must agree across the two machines. All three currently ship empty in the
working tree, and an empty `CarameliNotifySecret` rejects *every* notify with 401 —
indistinguishable from a wrong secret.

| Value | Remote Carameli (`.env`) | Local VanillaLand |
| --- | --- | --- |
| notify signing secret | `CARAMELI_NOTIFY_SECRET` | `CarameliNotifySecret` in `AppCode/VanillaSoft.VoipApi/Web.config` |
| Carameli API base | — | `CarameliApiBaseUrl` in `AppCode/Vanillasoft.Web/Web.config`, e.g. `https://<remote>.ngrok-free.dev/vsapi/1.0.0/` (**trailing slash required**) |
| Carameli API key | key of the E2E customer | `CarameliApiKey` in the same file |

`CarameliApiBaseUrl` needs the trailing slash and the full `/vsapi/1.0.0/` path:
`CarameliClient` derives the native `/api/v1` tree from that URL's *origin*, so a base URL
missing the path breaks the vsapi calls while the native ones keep working — a partial
failure that is confusing to diagnose. `test_vsapi_tree_is_served_at_the_configured_prefix`
covers it.

Recycle the IIS app pool after editing a `Web.config`:

```powershell
Restart-WebAppPool -Name VanillaSoft
```

### 4. The reverse tunnel

Remote Carameli cannot deliver a notify to `localhost:8021`, so local IIS needs its own
public URL. Without it the reverse-direction tests skip rather than fail — they are not
broken, just not connected.

```powershell
python scripts/start-vs-tunnel.py
```

That starts `ngrok http 8021`, waits for the tunnel to register, writes
`VS_PUBLIC_BASE_URL` (with the `/voip` application path appended — override with
`--app-path`) into `.env.local-e2e`, and prints the two values to set on the remote.
Re-run it after any tunnel restart — it rewrites the line rather than appending, so the
file never accumulates stale URLs.

It needs an authtoken once per machine:

```powershell
ngrok config add-authtoken <token>
```

**The free plan allows one agent session per account, and the remote box is already using
one.** If this fails with `ERR_NGROK_108`, use a second free account, upgrade, or run
`cloudflared tunnel --url http://localhost:8021` for this side — cloudflared's quick
tunnels need no account at all — and set `VS_PUBLIC_BASE_URL` by hand.

Then set, on the **remote** Carameli:

```dotenv
VANILLASOFT_WEBHOOK_URL=https://<your-local-tunnel>.ngrok-free.dev/voip
VANILLASOFT_NOTIFY_PREFIX=carameli/notify
```

The `/voip` suffix is the IIS application path, and the prefix flip is what moves
Carameli off the legacy fire-and-forget `CloudliController` onto the honest receiver.
Deploy order matters: the controller must be serving before Carameli starts posting to
those routes — locally it already is, so flip the prefix whenever you like.

Free ngrok URLs change on restart. When the reverse-direction tests start failing after a
tunnel restart, that is the first thing to check.

### 5. Configure the suite

```powershell
Copy-Item .env.local-e2e.example .env.local-e2e
```

Fill it in (the file is git-ignored) and run the suite.

## ngrok's interstitial

ngrok's free tier answers browser-looking requests with an HTML warning page carrying
**HTTP 200**. Any check that asserts only a status code passes on a response that never
reached Carameli at all. Every request the suite makes sends
`ngrok-skip-browser-warning: 1`, and `helpers.assert_json` re-checks that the body is
really JSON. Do the same in any ad-hoc curl:

```powershell
curl.exe -s -H "ngrok-skip-browser-warning: 1" https://<remote>.ngrok-free.dev/health
```

## Where errors land in this topology

| Failure mode | Evidence | How to read it |
| --- | --- | --- |
| VanillaSoft rejected or failed a notify | The response body itself — the receiver is synchronous and honest | The suite prints it in the assertion message; live traffic puts it in `carameli.log` on the remote |
| VanillaSoft-side exception, any app | Local Elasticsearch, index `vanillasoft_dev.events` | query below |
| VanillaSoft error outside an HTTP exchange Carameli sees | `POST /webhooks/vs-log` on the remote → `carameli.log` there | `test_30_log_channel.py` proves the channel works |
| Carameli's own errors | `logs/runtime/carameli.log` **on the remote box** | not readable from here — this is why the vs-log bridge exists |
| Notify never arrived | Nothing local. Carameli's retry cron and reconciliation ERRORs, both remote | check the remote, or re-run `test_20` to prove the receiver is fine |

Recent VanillaSoft errors from the local log channel:

```bash
curl -s "http://localhost:9200/vanillasoft_dev.events/_search" -H 'Content-Type: application/json' -d '{
  "query": {"bool": {"filter": [{"terms": {"level": ["Error", "Fatal", "Warn"]}}]}},
  "sort": [{"@timestamp": "desc"}], "size": 20
}'
```

Everything one call left behind, joined on the call id:

```bash
curl -s "http://localhost:9200/vanillasoft_dev.events/_search" -H 'Content-Type: application/json' -d '{
  "query": {"match_phrase": {"message": "<callId>"}},
  "sort": [{"@timestamp": "asc"}], "size": 50
}'
```

The NLog configuration writing to that index is currently a **local, uncommitted change**
in the VanillaLand working tree (`*.bak-carameli` files hold the originals). It logs at
`Debug` on purpose — that verbosity is the point of the channel — and points at
`http://localhost:9200`, never the company cluster. Lower it to `Warn` when you are done
debugging, and do not commit the local URL over the shared one.

## Cleaning up test rows

Every call id the suite generates is a real GUID beginning `10ca1e2e` — "localE2E" written
in hex. It has to be a valid GUID because `callIdUuid` reaches SQL Server as a
`uniqueidentifier`; a readable prefix fails the cast with *"Conversion failed when
converting from a character string to uniqueidentifier"* before the insert is attempted.

```sql
DELETE FROM dbo.tblCMVCallNotification WHERE UUID LIKE '10CA1E2E-%';
```

## Related

- [`diagnostics-error-map.md`](diagnostics-error-map.md) — the error map for the
  *original* topology (Carameli local). Still correct about Carameli's own internals;
  its log-location advice does not apply here.
- [`vanillasoft-connectivity-preflight.md`](vanillasoft-connectivity-preflight.md) —
  host/identity/permission checks, written for Carameli-local. `scripts/probe-connectivity.py`
  probes *outward* from a Carameli machine and is not the right tool from here; the
  suite's `test_00_preflight.py` is.
