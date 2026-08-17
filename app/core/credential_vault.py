from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class CredentialVaultError(RuntimeError):
    pass


def _fernet() -> Fernet:
    secret = settings.sip_credential_encryption_secret
    if len(secret) < 32:
        raise CredentialVaultError(
            "SIP_CREDENTIAL_ENCRYPTION_SECRET must contain at least 32 characters"
        )
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError, UnicodeEncodeError) as exc:
        raise CredentialVaultError("Stored SIP credential cannot be decrypted") from exc
