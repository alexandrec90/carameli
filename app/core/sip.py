from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def agent_sip_uri(sip_username: str, sip_domain_sid: str | None) -> str:
    """Build the SIP URI for an agent extension from its stored credentials.

    ``sip_domain_sid`` is used as the SIP domain identifier; when absent the
    stored username is assumed to already be a routable URI/user.
    """
    if sip_domain_sid:
        return f"sip:{sip_username}@{sip_domain_sid}"
    return sip_username
