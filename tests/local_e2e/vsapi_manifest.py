"""The manifest of every ``/vsapi/1.0.0`` route, and what coverage each one gets.

``/vsapi`` exists because VanillaSoft's .NET clients call it — ``CloudliClient.cs`` and
``CarameliClient.cs`` in the VanillaLand repo. Nothing else does. That makes it the part
of Carameli where a silent contract break is least likely to be noticed here and most
likely to page someone there, and it was until now the least covered by this suite.

**Coverage is not uniform, and the split is a safety property rather than an oversight.**
Carameli's dev ``.env`` carries real Telnyx and Jambonz credentials, so a successful
``VsMessaging/Sms/Send`` sends a real SMS and a successful ``Callback/ByExtension``
places a real call. Every route is therefore classified by whether its handler can reach
an external service:

- :data:`DB` — the handler only touches Postgres (and, for presigned URLs, a local HMAC
  computation that makes no request). Covered on the **success path**, with cleanup.
- :data:`EXTERNAL` — the handler reaches Telnyx, Jambonz, S3 or the ARQ queue. Covered
  by **contract only**: unauthenticated, malformed and unknown-customer shapes, each of
  which is rejected *before* the provider call. Never driven to success.

The classification is made by reading the handler in ``app/api/vsapi/``, never by trying
the route and seeing what happens — "try it and find out" is exactly the move that sends
an SMS.

``test_15_vsapi_contract.py`` asserts every path in the live ``/openapi.json`` appears
here, so adding a route to ``app/api/vsapi/`` fails this suite until it is classified and
covered. That guard is the reason the manifest is data in its own module rather than a
list inlined in one test.
"""

from __future__ import annotations

from dataclasses import dataclass

VSAPI_PREFIX = "/vsapi/1.0.0"

#: The handler reaches Postgres and nothing else. Success-path coverage.
DB = "db"

#: The handler can reach Telnyx, Jambonz, S3 or ARQ. Contract coverage only.
EXTERNAL = "external"

# Values substituted into ``{...}`` path segments for the contract probes. Ids are
# ``SYNTHETIC_GUID_PREFIX``-tagged GUIDs and the customer id is one no customer has, so a
# probe that somehow got past auth would still find nothing to act on.
UNKNOWN_CUSTOMER_ID = "999999"
UNKNOWN_GUID = "10ca1e2e-0000-4000-8000-000000000001"

PATH_PARAM_SAMPLES: dict[str, str] = {
    "customerId": UNKNOWN_CUSTOMER_ID,
    "call_sid": UNKNOWN_GUID,
    "agentId": UNKNOWN_GUID,
    "skillId": UNKNOWN_GUID,
    # An integer, not a GUID: VsArchive export ids are a serial column, and a GUID here
    # is a 422 on path parsing that never reaches the customer-scope check.
    "exportId": "999999",
    "assetId": UNKNOWN_GUID,
    "queueId": UNKNOWN_GUID,
    "conferenceId": UNKNOWN_GUID,
    "exemptionId": UNKNOWN_GUID,
    "moduleId": UNKNOWN_GUID,
    "groupId": UNKNOWN_GUID,
    "lotId": UNKNOWN_GUID,
    "dialId": UNKNOWN_GUID,
    "subscriptionId": UNKNOWN_GUID,
    "extension": "98899",
    "startExt": "98800",
    "endExt": "98899",
    "phoneNumber": "+15145550100",
    "smsPhoneNumber": "+15145550100",
    "country": "US",
    "state": "TX",
}


@dataclass(frozen=True)
class Route:
    """One ``/vsapi`` operation and the coverage decision made about it.

    ``why`` is required for :data:`EXTERNAL` routes and carries the specific provider
    call the contract tests must stay upstream of. It is the note a future reader needs
    before "upgrading" a contract test into a success-path one.
    """

    method: str
    path: str
    kind: str
    caller: str = ""
    why: str = ""

    #: Whether *any* authenticated request to this route is safe to make.
    #:
    #: False only where the handler has no customer scoping to fail on, so an
    #: authenticated request necessarily reaches the provider. Those routes get the
    #: unauthenticated probes and nothing else — there is no authenticated shape that
    #: proves the route exists without also calling Telnyx.
    authenticated_probe: bool = True

    @property
    def has_body(self) -> bool:
        """Whether the route binds a JSON request body.

        ``DELETE`` is in the set because the tree's only DELETE —
        ``DeletePointerToExtension`` — takes one, mirroring the legacy contract rather
        than REST convention.
        """
        return self.method in {"POST", "PUT", "PATCH", "DELETE"}

    def concrete(self) -> str:
        """The path with every ``{param}`` replaced by a sample value."""
        resolved = self.path
        for name, value in PATH_PARAM_SAMPLES.items():
            resolved = resolved.replace("{" + name + "}", value)
        if "{" in resolved:
            raise KeyError(f"no PATH_PARAM_SAMPLES entry for a parameter in {self.path}")
        return resolved


# --------------------------------------------------------------------------------------
# The manifest
# --------------------------------------------------------------------------------------
#
# `caller` cites the .NET call site whose request shape the tests replay, as
# `<file>:<line>` under AppCode/VanillaSoft.Backend/. An empty `caller` means neither
# client calls the route today — those still get auth + validation coverage, because
# "unused" is a fact about this week's callers and not about the route.

ROUTES: tuple[Route, ...] = (
    # -- customers -----------------------------------------------------------------
    Route("POST", "/VsCustomer/Add", DB, "CloudliClient.cs:899"),
    Route("POST", "/VsCustomer/Create", DB, "CarameliClient.cs:316"),
    Route("GET", "/VsCustomer/Get/{customerId}", DB, "CloudliClient.cs:241"),
    Route("GET", "/VsCustomer/GetCustid/{customerId}", DB, "CloudliClient.cs:272"),
    Route("GET", "/VsCustomer/GetPhoneLines/{customerId}", DB, "CloudliClient.cs:520"),
    # -- phone lines ---------------------------------------------------------------
    Route(
        "POST",
        "/PhoneLine/Add",
        EXTERNAL,
        "CloudliClient.cs:436",
        "purchases a DID: carrier.search_available_numbers + purchase_number",
    ),
    Route(
        "PUT",
        "/PhoneLine/Deactivate",
        EXTERNAL,
        "CloudliClient.cs:382",
        "releases the DID at the carrier: carrier.release_number",
    ),
    Route("GET", "/PhoneLine/Get/{customerId}/{phoneNumber}", DB, "CloudliClient.cs:586"),
    Route("GET", "/PhoneLine/GetCount/{customerId}", DB, "CloudliClient.cs:491"),
    Route("PUT", "/PhoneLine/SetAutoAttendant", DB, "CloudliClient.cs:979"),
    Route("PUT", "/PhoneLine/UpdateCallRecording", DB, "CloudliClient.cs:303"),
    # -- extensions ----------------------------------------------------------------
    Route(
        "POST",
        "/VsExtension/Add",
        EXTERNAL,
        "CloudliClient.cs:154",
        "provisions a SIP endpoint on the call engine via extension_service",
    ),
    Route(
        "PUT",
        "/VsExtension/Deactivate/{customerId}/{extension}",
        EXTERNAL,
        "CloudliClient.cs:373",
        "deprovisions the SIP endpoint: extension_service.deactivate_provisioned(engine)",
    ),
    Route(
        "GET",
        "/VsExtension/GetAvailable/{customerId}/{startExt}/{endExt}",
        DB,
        "CloudliClient.cs:210",
    ),
    # -- area codes ----------------------------------------------------------------
    # These two take no customer id anywhere, so an authenticated request has nothing to
    # be rejected by and goes straight to the carrier. Unauthenticated probes only.
    Route(
        "GET",
        "/GetAreaCodes",
        EXTERNAL,
        "CloudliClient.cs:765",
        "carrier.get_available_area_codes — read-only, but a live Telnyx HTTP call",
        authenticated_probe=False,
    ),
    Route(
        "GET",
        "/GetAreaCodes/{country}/{state}",
        EXTERNAL,
        "CloudliClient.cs:795",
        "carrier.get_available_area_codes — read-only, but a live Telnyx HTTP call",
        authenticated_probe=False,
    ),
    # -- SMS -----------------------------------------------------------------------
    Route(
        "POST",
        "/VsMessaging/Sms/Send/{customerId}",
        EXTERNAL,
        "CloudliClient.cs:626 / CarameliClient.cs:244",
        "carrier.send_sms — a success here sends a real text message",
    ),
    Route(
        "PUT",
        "/VsMessaging/Sms/Enable/{customerId}/{smsPhoneNumber}",
        EXTERNAL,
        "CloudliClient.cs:67",
        "carrier.enable_sms",
    ),
    Route(
        "PUT",
        "/VsMessaging/Sms/Disable/{customerId}/{smsPhoneNumber}",
        EXTERNAL,
        "CloudliClient.cs:103",
        "carrier.disable_sms",
    ),
    Route("GET", "/VsMessaging/Sms/List/{customerId}", DB),
    # -- calls and callback --------------------------------------------------------
    Route(
        "POST",
        "/VsCall/Initiate",
        EXTERNAL,
        "",
        "engine.originate — a success here places a real call",
    ),
    Route(
        "POST",
        "/Callback/ByExtension",
        EXTERNAL,
        "CloudliClient.cs:1134 / CarameliClient.cs:343",
        "engine.originate — a success here places a real call",
    ),
    Route("GET", "/VsCall/List/{customerId}", DB),
    Route("GET", "/VsCall/Summary/{customerId}", DB),
    Route("GET", "/VsCall/Recording/{call_sid}", DB),
    Route(
        "GET",
        "/CallRecordings/Export/{customerId}/{call_sid}",
        DB,
    ),
    # -- recordings archive --------------------------------------------------------
    Route(
        "POST",
        "/VsArchive",
        EXTERNAL,
        "CloudliClient.cs:1069",
        "enqueues an ARQ job that reads and writes S3",
    ),
    Route("GET", "/VsArchive/{customerId}/{exportId}", DB, "CloudliClient.cs:1069"),
    # -- voicemail drop ------------------------------------------------------------
    Route(
        "POST",
        "/VsMessageDrop",
        EXTERNAL,
        "",
        "engine.originate for the drop — a success here places a real call",
    ),
    Route("GET", "/VsMailboxDrop/List/{customerId}", DB),
    # -- audio assets --------------------------------------------------------------
    Route("POST", "/VsAudio/PresignedUpload", DB),
    Route("POST", "/VsAudio/ConfirmUpload", DB),
    Route("GET", "/VsAudio/List/{customerId}", DB),
    Route("PUT", "/VsAudio/Deactivate/{customerId}/{assetId}", DB),
    # -- directory objects: Add / List / Deactivate triplets ------------------------
    Route("POST", "/VsAgent/Add", DB),
    Route("GET", "/VsAgent/List/{customerId}", DB),
    Route("PUT", "/VsAgent/Deactivate/{customerId}/{agentId}", DB),
    Route("POST", "/VsAgentSkill/Add", DB),
    Route("GET", "/VsAgentSkill/List/{customerId}", DB),
    Route("PUT", "/VsAgentSkill/Deactivate/{customerId}/{skillId}", DB),
    Route("POST", "/VsCallQueue/Add", DB),
    Route("GET", "/VsCallQueue/List/{customerId}", DB),
    Route("PUT", "/VsCallQueue/Deactivate/{customerId}/{queueId}", DB),
    Route("POST", "/VsConference/Add", DB),
    Route("GET", "/VsConference/List/{customerId}", DB),
    Route("PUT", "/VsConference/Deactivate/{customerId}/{conferenceId}", DB),
    Route("POST", "/VsExemptionCode/Add", DB),
    Route("GET", "/VsExemptionCode/List/{customerId}", DB),
    Route("PUT", "/VsExemptionCode/Deactivate/{customerId}/{exemptionId}", DB),
    Route("POST", "/VsExpansionModule/Add", DB),
    Route("GET", "/VsExpansionModule/List/{customerId}", DB),
    Route("PUT", "/VsExpansionModule/Deactivate/{customerId}/{moduleId}", DB),
    Route("POST", "/VsGroupExtension/Add", DB),
    Route("GET", "/VsGroupExtension/List/{customerId}", DB),
    Route("PUT", "/VsGroupExtension/Deactivate/{customerId}/{groupId}", DB),
    Route("POST", "/VsIntercom/Add", DB),
    Route("GET", "/VsIntercom/List/{customerId}", DB),
    Route("PUT", "/VsIntercom/Deactivate/{customerId}/{groupId}", DB),
    Route("POST", "/VsMulticast/Add", DB),
    Route("GET", "/VsMulticast/List/{customerId}", DB),
    Route("PUT", "/VsMulticast/Deactivate/{customerId}/{groupId}", DB),
    Route("POST", "/VsParking/Add", DB),
    Route("GET", "/VsParking/List/{customerId}", DB),
    Route("PUT", "/VsParking/Deactivate/{customerId}/{lotId}", DB),
    Route("POST", "/VsSpeedDial/Add", DB),
    Route("GET", "/VsSpeedDial/List/{customerId}", DB),
    Route("PUT", "/VsSpeedDial/Deactivate/{customerId}/{dialId}", DB),
    Route("POST", "/VsWebhook/Add", DB),
    Route("GET", "/VsWebhook/List/{customerId}", DB),
    Route("PUT", "/VsWebhook/Deactivate/{customerId}/{subscriptionId}", DB),
    # -- misc ----------------------------------------------------------------------
    Route("GET", "/VsToken/List/{customerId}", DB),
    Route("GET", "/AgentStatus/{customerId}", DB),
    Route("PUT", "/Branch/Assign", DB, "CloudliClient.cs:1024"),
    Route("POST", "/Precall/Add", DB, "CloudliClient.cs:670"),
    Route("POST", "/AddPointerToExtension", DB),
    Route("DELETE", "/DeletePointerToExtension", DB),
    Route("POST", "/PostSCIbyZipCode", DB),
    Route("POST", "/UpdateSCIUserOption", DB),
    Route("POST", "/AccessCheck/AccountData", DB),
)


# Routes an ordinary customer-scoped key may not call at all: creating a customer is an
# admin act, so these answer 401 rather than 403 — the key is not merely wrong for this
# customer, it is not a key that can create customers.
ADMIN_ONLY_PATHS = frozenset({"/VsCustomer/Add", "/VsCustomer/Create"})

# Routes that take neither a customer id nor a body, so the only shape available is a
# lookup that finds nothing.
UNSCOPED_LOOKUP_PATHS = frozenset({"/VsCall/Recording/{call_sid}"})

# Carries ``{customerId}`` in the path *and* declares a required request-body model, so
# FastAPI's body validation runs before the handler's customer-scope check and an empty
# body is 422 rather than 403. The other ``{customerId}`` writes take no body model — the
# scope check is the first thing that runs — which is why this is an exception list and
# not the rule. Either ordering rejects before the carrier is called, which is the
# property that actually matters here.
BODY_VALIDATED_BEFORE_SCOPE_PATHS = frozenset({"/VsMessaging/Sms/Send/{customerId}"})


def expected_contract_status(route: Route) -> int | None:
    """The status an *authenticated* contract probe must get, or ``None`` for no probe.

    Encoded as a rule rather than 79 literals because the rule is the contract the .NET
    clients depend on, and a table of literals would hide the moment one route stopped
    following it:

    - :data:`ADMIN_ONLY_PATHS` answer 401 to a customer-scoped key;
    - :data:`BODY_VALIDATED_BEFORE_SCOPE_PATHS` answer 422, because FastAPI binds their
      declared body model before the handler's scope check ever runs;
    - a path carrying ``{customerId}`` is otherwise scope-checked **first**, so an unknown
      customer is 403 even when the body is also invalid — the check runs before the
      payload binds and therefore before any provider call;
    - :data:`UNSCOPED_LOOKUP_PATHS` answer 404;
    - otherwise a body route rejects an empty object with 422.

    The ordering matters and is the load-bearing part: it is what makes the probes safe
    to send at a route whose success path would place a call. Note that *which* of 403 and
    422 comes back is not the safety property — both reject before the carrier is reached.
    The status is asserted because the .NET clients branch on it, not because one of them
    would be dangerous.
    """
    if not route.authenticated_probe:
        return None
    if route.path in ADMIN_ONLY_PATHS:
        return 401
    if route.path in BODY_VALIDATED_BEFORE_SCOPE_PATHS:
        return 422
    if "{customerId}" in route.path:
        return 403
    if route.path in UNSCOPED_LOOKUP_PATHS:
        return 404
    if route.has_body:
        return 422
    raise AssertionError(f"no contract probe defined for {route.method} {route.path}")


def openapi_path(route: Route) -> str:
    """The route's key as it appears in ``/openapi.json``."""
    return f"{VSAPI_PREFIX}{route.path}"


def covered_operations() -> set[tuple[str, str]]:
    """``(METHOD, openapi path)`` for everything this manifest claims to cover."""
    return {(route.method, openapi_path(route)) for route in ROUTES}


def routes_of_kind(kind: str) -> tuple[Route, ...]:
    return tuple(route for route in ROUTES if route.kind == kind)


def route_id(route: Route) -> str:
    """Stable pytest parameter id, so a failure names the route not an index."""
    return f"{route.method}-{route.path}"
