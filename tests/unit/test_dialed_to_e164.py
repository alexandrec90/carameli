"""Tests for keypad-dialled string → E.164 normalisation."""

from __future__ import annotations

import pytest

from app.core.phone import dialed_to_e164


@pytest.mark.parametrize(
    ("dialed", "expected"),
    [
        ("+14385551212", "+14385551212"),
        ("+1 (438) 555-1212", "+14385551212"),
        ("+442071838750", "+442071838750"),
        ("14385551212", "+14385551212"),
        ("4385551212", "+14385551212"),
        ("(438) 555-1212", "+14385551212"),
        ("438-555-1212", "+14385551212"),
        ("438.555.1212", "+14385551212"),
    ],
)
def test_dialable_inputs_normalize_to_e164(dialed: str, expected: str) -> None:
    assert dialed_to_e164(dialed) == expected


@pytest.mark.parametrize(
    "dialed",
    [
        "",
        "   ",
        "101",  # an extension, not a PSTN destination
        "*97",  # feature code
        "911",  # too short to be a NANP number; emergency routing is separate
        "24385551212",  # 11 digits not starting with the NANP country code
        "438555121",  # nine digits
        "operator",
        "+",
    ],
)
def test_undialable_inputs_return_none(dialed: str) -> None:
    assert dialed_to_e164(dialed) is None
