# VanillaSoft connectivity preflight

Use this before designing or running a live Carameli–VanillaSoft test. It separates
three questions that otherwise get conflated:

1. Can one host reach the other host?
2. Can the intended Windows or SQL identity read the resource?
3. Does a real call or SMS complete the application contract?

The first two stages are non-mutating application checks. HTTP GET requests can still
appear in IIS, proxy, or ngrok access logs. The final live E2E stage uses real provider
traffic and may cost money.

## Stage 1: Carameli to VanillaSoft

On the Carameli development machine, set these values in `.env`:

```dotenv
VANILLASOFT_WEBHOOK_URL=https://vs-staging.example.com/voip
VS_PROBE_HOST=vs-staging.example.com
VS_PROBE_DB_HOST=sql-staging.example.com
NGROK_URL=https://your-domain.ngrok.app
```

`VS_PROBE_HOST` is optional when it matches the webhook URL host. Set
`VS_PROBE_DB_HOST` when SQL Server is on a different host.

Run:

```powershell
python scripts/probe-connectivity.py --json
```

The probe checks VanillaSoft application HTTPS, the synchronous notify route, SQL
Server TCP 1433, WinRM, RPC, SMB, and the local ngrok inspector. It overwrites
`logs/connectivity-probe.log` with the complete result. Port success proves network
reachability only; it does not prove authentication or read permission.

## Stage 2: permissions from the VanillaSoft server

Copy this repository file to the VanillaSoft application server using the normal
administrative channel:

```text
tools/vanillasoft-preflight/carameli-preflight.ps1
```

Inspect it before running it. If Windows marks the copied file as downloaded, unblock
that file only; do not change the machine-wide execution policy:

```powershell
Unblock-File .\carameli-preflight.ps1
```

### Minimal reverse-path check

This proves that the VanillaSoft server can reach Carameli through its public URL:

```powershell
.\carameli-preflight.ps1 `
  -CarameliUrl 'https://your-domain.ngrok.app' `
  -SkipEventLog
```

The tool calls `GET /health`; it never posts a webhook.

### Application, Event Log, file log, and integrated SQL access

Run under the exact Windows identity that will perform diagnostics:

```powershell
.\carameli-preflight.ps1 `
  -CarameliUrl 'https://your-domain.ngrok.app' `
  -VanillaSoftNotifyUrl 'https://localhost/voip/carameli/notify/IncomingCall' `
  -EventLogName 'Application' `
  -LogPath 'C:\path\to\vanillasoft.log' `
  -SqlHost 'sql-staging.example.com' `
  -SqlDatabase 'VanillaSoft' `
  -SqlReadObject 'dbo.IntendedTable'
```

The notify route receives a GET only. HTTP 401, 403, or 405 is useful evidence that a
protected or POST-only route exists; HTTP 404 means it is not deployed at that URL.

The SQL checks are deliberately separate:

- `sql-tcp` establishes network reachability.
- `sql-login` opens and closes a SQL connection without executing a query.
- `sql-object-read` runs `SELECT TOP (0)` against one allowlisted `schema.table` name.
  SQL Server checks SELECT permission but returns no rows or column values.

Integrated Windows authentication is the default. To test a dedicated SQL login, keep
the credential in memory and pass it explicitly:

```powershell
$sqlCredential = Get-Credential
.\carameli-preflight.ps1 `
  -CarameliUrl 'https://your-domain.ngrok.app' `
  -SkipEventLog `
  -SqlHost 'sql-staging.example.com' `
  -SqlDatabase 'VanillaSoft' `
  -SqlReadObject 'dbo.IntendedTable' `
  -SqlCredential $sqlCredential
```

SQL encryption is enabled by default. A staging server with a private/self-signed
certificate may require `-TrustSqlServerCertificate`. Use
`-DisableSqlEncryption` only when it matches the intended legacy connection and the
network is trusted.

### Result file

Every run prints a short summary and overwrites
`carameli-preflight-result.json` beside the script unless `-OutputPath` is supplied.
The report contains host/identity metadata and pass/fail details. It contains no SQL
rows, log contents, credential values, or webhook bodies. A requested failed check
returns exit code 1; channels without configuration are marked `not_run`.

Keep the report in the approved diagnostic location. Although it has no application
data, it does identify internal hosts, paths, and the Windows identity used.

## Stage 3: the real contract

After both preflights establish the usable channels, follow
[`diagnostics-error-map.md`](diagnostics-error-map.md#5-running-the-live-e2e-suite) and
run one live E2E module at a time. The live suite is explicitly opt-in because calls
and SMS can incur provider charges.

Do not expose MSSQL, SMB, WinRM, arbitrary SQL, or arbitrary log-reading endpoints to
the public internet for this test. If persistent remote diagnostics become necessary,
use the organization's private administrative network and a least-privilege identity.
