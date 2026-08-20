from __future__ import annotations

import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


def agent_sip_uri(sip_username: str, sip_domain_sid: str | None) -> str:
    """Build the SIP URI for an agent extension from its stored credentials.

    ``sip_domain_sid`` is used as the SIP domain identifier; when absent the
    stored username is assumed to already be a routable URI/user.
    """
    if sip_domain_sid:
        return f"sip:{sip_username}@{sip_domain_sid}"
    return sip_username


def webphone_ws_uri(sip_domain_sid: str | None) -> str:
    """Build the SIP-over-WebSocket URI a browser softphone registers against.

    Jambonz terminates SIP over WSS (and the DTLS-SRTP media that goes with it) on
    the account's own SIP realm, so the browser needs no separate media path — the
    same realm the extension's SIP URI uses, on the WSS port.

    ``settings.sip_wss_url`` overrides the whole URI for a deployment whose SBC is
    not reachable at the derived address (a self-hosted stack behind a proxy, say).
    """
    if settings.sip_wss_url:
        return settings.sip_wss_url
    if not sip_domain_sid:
        return ""
    return f"wss://{sip_domain_sid}:{settings.sip_wss_port}"
