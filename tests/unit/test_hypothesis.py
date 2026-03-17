from __future__ import annotations

import re

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from app.schemas.sms import SendSmsRequest
from app.schemas.voicemail import VoicemailDropRequest

# Property-based tests using Hypothesis.
#
# Targets:
#   1. E.164 phone number validation in VoicemailDropRequest
#      (app/schemas/voicemail.py — the only schema that enforces E.164 via a
#      regex pattern field).
#   2. SMS body round-trip through SendSmsRequest — any non-empty string must
#      be accepted as-is (the schema imposes no length cap; this test documents
#      that contract and would catch a future accidental restriction).
#   3. Rate-limit config strings — valid "<count>/<period>" strings accepted by
#      slowapi must parse without raising an exception when stored in Settings.

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")

# A valid audio URL required by VoicemailDropRequest so we can isolate the
# phone-number field in our tests.
_VALID_AUDIO_URL = "https://example.com/audio.mp3"

# A valid E.164 number used as the "other" field when we're varying one field.
_VALID_NUMBER = "+12015550100"

# Slowapi period tokens accepted in rate-limit strings.
_SLOWAPI_PERIODS = ["second", "minute", "hour", "day"]


# ---------------------------------------------------------------------------
# Test 1 — E.164 phone number validation
#
# VoicemailDropRequest.extension and .msg_drop_number both use pattern=_E164_PATTERN
# (r"^\+[1-9]\d{6,14}$"). We generate arbitrary text strings and assert that
# Pydantic accepts only those that truly match the pattern.
# ---------------------------------------------------------------------------


@given(candidate=st.text(min_size=0, max_size=30))
@settings(max_examples=300)
def test_voicemail_drop_e164_validation_matches_pattern(candidate: str) -> None:
    """Schema accepts a phone-number string if and only if it matches E.164."""
    should_pass = bool(_E164_RE.match(candidate))

    if should_pass:
        # Must not raise.
        obj = VoicemailDropRequest(
            vs_customer_id=1,
            extension=candidate,
            msg_drop_number=_VALID_NUMBER,
            audio_url=_VALID_AUDIO_URL,
        )
        assert obj.extension == candidate.strip()
    else:
        with pytest.raises(ValidationError):
            VoicemailDropRequest(
                vs_customer_id=1,
                extension=candidate,
                msg_drop_number=_VALID_NUMBER,
                audio_url=_VALID_AUDIO_URL,
            )


# ---------------------------------------------------------------------------
# Test 2 — SMS body round-trip
#
# SendSmsRequest imposes no length restriction on `body`. Any non-empty string
# must be stored verbatim (no truncation, coercion, or rejection).
# ---------------------------------------------------------------------------


@given(body=st.text(min_size=1, max_size=1600))
@settings(max_examples=200)
def test_sms_body_round_trips_unchanged(body: str) -> None:
    """Any non-empty body string is accepted and preserved by SendSmsRequest."""
    req = SendSmsRequest(
        from_number=_VALID_NUMBER,
        to_number="+14155550100",
        body=body,
    )
    assert req.body == body


# ---------------------------------------------------------------------------
# Test 3 — Rate-limit config string parsing
#
# Settings stores rate_limit_sms / rate_limit_calls as plain strings and
# passes them to slowapi at decorator time.  Valid strings have the form
# "<positive-integer>/<period>" where period is one of slowapi's recognised
# tokens.  We verify that constructing a Settings object with any such string
# does not raise — i.e. the field accepts the value without its own validator
# rejecting it.
# ---------------------------------------------------------------------------


@given(
    count=st.integers(min_value=1, max_value=10_000),
    period=st.sampled_from(_SLOWAPI_PERIODS),
)
@settings(max_examples=100)
def test_rate_limit_string_accepted_by_settings(count: int, period: str) -> None:
    """Valid '<count>/<period>' strings are stored without error in Settings."""
    from app.core.config import Settings

    rate_str = f"{count}/{period}"
    s = Settings(
        rate_limit_sms=rate_str,
        rate_limit_calls=rate_str,
        # Suppress DB/Redis connection overhead — we only test field storage.
        database_url="postgresql+asyncpg://u:p@localhost/db",
        redis_url="redis://localhost:6379",
        _env_file=None,  # Skip .env I/O to avoid disk overhead and env contamination
    )
    assert s.rate_limit_sms == rate_str
    assert s.rate_limit_calls == rate_str
