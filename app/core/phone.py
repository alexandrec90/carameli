from __future__ import annotations


def normalize_phone_number(value: object) -> object:
    """Normalize phone-number-like string input for Pydantic validators."""
    if isinstance(value, str):
        return value.strip()
    return value


def dialed_to_e164(dialed: str) -> str | None:
    """Best-effort E.164 for a string dialled on a softphone keypad.

    Softphones send whatever the user typed, so a NANP number arrives as any of
    ``+14385551212``, ``14385551212``, ``4385551212`` or ``(438) 555-1212``,
    while carriers accept only the first spelling. Returns ``None`` when the
    input is not something we can place a PSTN call to — an extension, a SIP
    user, a feature code — and the caller decides what that means.
    """
    trimmed = dialed.strip()
    if not trimmed:
        return None
    digits = "".join(ch for ch in trimmed if ch.isdigit())
    if not digits:
        return None
    if trimmed.startswith("+"):
        # Already international; trust the country code the dialler supplied.
        return f"+{digits}"
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None
