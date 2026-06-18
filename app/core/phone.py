from __future__ import annotations


def normalize_phone_number(value: object) -> object:
    """Normalize phone-number-like string input for Pydantic validators."""
    if isinstance(value, str):
        return value.strip()
    return value
