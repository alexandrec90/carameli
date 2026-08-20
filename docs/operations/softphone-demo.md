# Softphone demo — registering a real phone against Carameli

How to put a working softphone on a Carameli extension so an end-to-end demo — dial out
from VanillaSoft, ring in on a Telnyx DID, hear both legs, get the recording back — runs
on real audio rather than on webhook logs.

Read this alongside [the prototype roadmap](../prototype-roadmap.md), which owns the
account-level decisions this runbook assumes.

## The call path, and where the softphone sits

```text
  PSTN ──── Telnyx (DID + SIP trunk) ──── call engine ──── softphone (SIP REGISTER)
                                              │
                                     webhooks │ verbs
                                              │
                                          Carameli ──── VanillaSoft
```

Carameli is **not** the SIP registrar. It provisions a SIP client on the call engine
(`provision_sip_client` in `app/services/providers/engine/jambonz.py`), stores the
username and realm on the extension row, and thereafter refers to the phone only as a
URI — `sip:<username>@<realm>`, built by `app/core/sip.py` and handed to the engine
inside a `dial` verb. The softphone registers to the **call engine**, never to Carameli.

That single fact settles most of the setup: anything about credentials and routing is a
Carameli API call, and anything about SIP itself is call-engine and carrier
configuration.

## Two hard constraints, before anything else

**The compose `telephony` profile cannot register a softphone.** It brings up the
Jambonz API server, FreeSWITCH and rtpengine (`docker-compose.yml`) — but none of the
SBC components, and no feature server. Nothing in it listens for `REGISTER`, and nothing
in it executes the verbs Carameli returns. It is enough to exercise the
`CallEngineProvider` boundary and no more. A softphone pointed at it will retry forever
and report nothing useful.

So the demo runs against **hosted jambonz.cloud**, which is the decision already
recorded in the roadmap. Switching back to a self-hosted engine later is a
`JAMBONZ_BASE_URL` change plus trunk registration.

**VS Connect cannot be pointed at Carameli.** It is a rebranded CounterPath/Alianza Bria
client (`CPCAPI2_SharedLibrary.dll`, `CPCLR.dll` in its install directory), and its
branding, feature and server configuration files — `server.txt`, `features.xml`,
`space_settings.xml`, and the per-profile `settings.cps` under
`%APPDATA%\VanillaSoft\VS Connect\` — are all encrypted. The profile directories are
named `<number>@vanillasoft.com`: the client is provisioned by logging in to
VanillaSoft's own service, and there is no supported path to hand it a foreign SIP
realm from outside.

The only route that could exist runs through VanillaSoft, not through the client: its
`SaveDialingInformation` web method (`VanillaSoft.Webservice/VanillaSoftWS_DialingInformation.cs`)
persists a user's `SIPUserName` / `SIPPassword` / `SIPDomain`, and a `connectme`-typed
line reads them back from the VoIP vendor. Making that serve Carameli's realm is a
VanillaLand change on a staging server, and it still depends on the branded client
honouring a realm that is not `vanillasoft.com` — untested, and not something to find
out during a demo.

**Use Zoiper.** It is a generic SIP client, it takes a realm, username and password, and
it is the supported way to demo this. Keep VS Connect in the story as what production
would replace, not as the phone on the desk.

## One-time account setup

Both providers expose all of this over their REST APIs, so once the keys in `.env` are
valid none of it is portal work. Only two things genuinely are not automatable: signing
up for the accounts in the first place, and paying for them.

1. **Telnyx** (`https://api.telnyx.com/v2`, `Bearer $TELNYX_API_KEY`). Numbers are sold
   through `POST /number_orders` — `POST /phone_numbers` does not exist and 404s with
   error 10005. A number the account already owns is found with
   `GET /phone_numbers?filter[phone_number]=+1...`, whose `data[].id` is the resource id
   everything else takes. Attach it to a SIP connection authorised for the call engine's
   signalling addresses via `PATCH /phone_numbers/{id}` with `connection_id`.
   `TELNYX_MESSAGING_PROFILE_ID` and `TELNYX_WEBHOOK_BASE_URL` govern SMS and come from
   `/messaging_profiles`.
2. **jambonz.cloud** (`https://api.jambonz.cloud/v1`, `Bearer $JAMBONZ_API_KEY`).
   `GET /Accounts/{sid}` reports the **SIP realm** — the domain the softphone registers
   to, and the value Carameli stores as `sip_domain_sid`. Register Telnyx under
   `/VoipCarriers`, and create an application under `/Applications` whose hooks point at
   Carameli's public URL:

   | Hook | URL |
   | --- | --- |
   | Call hook | `{JAMBONZ_WEBHOOK_BASE_URL}/webhooks/jambonz/incoming-call` |
   | Call status hook | `{JAMBONZ_WEBHOOK_BASE_URL}/webhooks/jambonz/call-status` |

   Bind the DID under `/PhoneNumbers` to that carrier and application.
3. **Check the account is active.** `GET /Accounts/{sid}` returns `is_active` and, on a
   trial, `trial_end_date`. A lapsed trial reads `is_active: 0` while every other API
   call still succeeds, so provisioning looks healthy right up to the point where no
   phone can register and no call arrives. Confirm this **before** blaming SIP.
   Reactivating it is a billing decision and is deliberately not scripted.
4. **A public URL for Carameli** — `scripts/start-ngrok.py` with a static domain. It
   rewrites the webhook base URLs in `.env`, pushes the new URL to the Telnyx messaging
   profile, and recreates the `app` and `worker` containers, so do not run it mid-demo.
   Only webhooks traverse the tunnel; media flows Telnyx to call engine and never
   touches it.
5. **Secrets.** `JAMBONZ_WEBHOOK_SECRET` and `TELNYX_WEBHOOK_SECRET` must match what
   each provider signs with, and `SIP_CREDENTIAL_ENCRYPTION_SECRET` must be set —
   provisioning an extension fails without it. See `.env.example`.

## Provision the extension

`POST /api/v1/extensions` accepts a `password`, which is what makes this a single
command rather than a sequence: without one, the generated password is encrypted at rest
and released exactly once through `POST /vsapi/1.0.0/AccessCheck/AccountData`, after
which it is erased. That one-time delivery is the right contract for VanillaSoft and the
wrong ergonomics for a demo.

```bash
python scripts/provision-softphone.py \
  --base-url https://your-carameli-host \
  --vs-customer-id 9001 \
  --extension 101 \
  --did +15145550100
```

It creates the customer if missing, provisions the extension and its call-engine SIP
client, points the DID at it, and prints the registration block. `--did` expects a number
already added through `POST /vsapi/1.0.0/PhoneLine/Add`; the pointer is what
`_inbound_dial_verbs` in `app/api/webhooks/call_status.py` reads to decide that an
inbound call should ring this extension.

`PhoneLine/Add` handles a number the account already owns — buying DIDs in the Telnyx
portal first and wiring them into Carameli afterwards is the ordinary order of
operations, and `TelnyxCarrier.provision_number` checks ownership before ordering rather
than letting Telnyx reject a duplicate order as a purchase failure.

The API key is `API_KEY_SECRET` from the running deployment — pass `--api-key`, or export
`CARAMELI_API_KEY`. The password is printed to stdout and written nowhere; re-running
against an existing extension returns 409 rather than reissuing it.

## Register Zoiper

Settings → Accounts → Add → SIP, then:

| Zoiper field | Value |
| --- | --- |
| Domain / host | the call engine's SIP realm (`sip_domain_sid`) |
| Username | `sip_username` from the script output |
| Password | the password the script printed |
| Auth username | same as username |
| Outbound proxy | blank, unless the hosted account documents one |
| Transport | UDP first; try TCP or TLS only if UDP fails to register |

The account must show **Registered**. Until it does, nothing below will work, and the
failure will look like a call that connects and then plays silence.

## Verify, in this order

Each step fails differently, so do not skip ahead.

1. **Registration.** `GET /Accounts/{sid}/RegisteredSipUsers` on the call engine shows
   the SIP user — that route, not `/registrations`, which 404s on jambonz.cloud.
   Carameli reads the same list through `get_registrations`, so a registered phone that
   Carameli cannot see is an account or credential mismatch, not a network problem. An
   empty list with a phone that insists it is registered usually means the account is
   inactive (step 3 of the setup above).
2. **Inbound.** Call the DID from a mobile. The softphone rings.
   - No ring, and no `incoming-call` in Carameli's log → Telnyx is not sending the call
     to the engine.
   - `incoming-call` logged, then *"No inbound route for to=..."* → the DID has no phone
     line, or the phone line has no pointer. Re-run the script with `--did`.
   - Routed, but the phone never rings → registration, or the realm stored on the
     extension does not match where the phone registered.
3. **Outbound / click-to-call.** `POST /vsapi/1.0.0/Callback/ByExtension` rings the
   softphone first, then bridges to the contact number when it is answered
   (`outbound-answered`). Answering the softphone is what triggers the second leg, so a
   call that rings and dies on answer is a webhook reachability problem, not a SIP one.
4. **Recording and write-back.** With recording enabled, the recording URL lands on
   `call_events`, and `POST notify/CallRecording` goes to VanillaSoft. Blank
   `VANILLASOFT_WEBHOOK_URL` skips the write-back silently — check it before concluding
   the recording failed.

`docs/operations/diagnostics-error-map.md` maps the failures that do not fit the four
buckets above.

## What an agent can and cannot do here

Anything reachable through the API or the repo is automatable, and now is: extension and
credential provisioning, DID pointers, the routing code, the verification endpoints, and
this runbook.

Provider setup is automatable too, and the earlier framing of it as portal work was
wrong: buying and assigning DIDs, the Telnyx SIP connection, the jambonz carrier,
application and number binding are all REST calls against the keys already in `.env`.

What is genuinely left: signing up for the provider accounts, paying for them —
including reactivating a lapsed trial, which is why an inactive account is its own
verification step — and installing Zoiper and typing the printed block into it. Given the
base URL and the API key, everything between those two ends is one command.
