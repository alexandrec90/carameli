from __future__ import annotations

import logging
import secrets
import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extension import Extension
from app.core.credential_vault import decrypt_secret, encrypt_secret
from app.core.sip import webphone_ws_uri
from app.repositories.extension_repo import ExtensionCreate, ExtensionRepo
from app.services.providers.base import CallEngineProvider

logger = logging.getLogger(__name__)


class WebphoneCredentialError(RuntimeError):
    """The extension cannot back a browser softphone in its current state."""


@dataclass(frozen=True)
class WebphoneCredential:
    sip_username: str
    sip_password: str
    sip_realm: str
    ws_uri: str


@dataclass(frozen=True)
class DeliveredSipCredential:
    first_name: str
    last_name: str
    extension: str
    sip_username: str
    sip_password: str
    sip_domain: str


async def get_by_number(
    session: AsyncSession, customer_id: uuid.UUID, extension_number: str
) -> Extension | None:
    return await ExtensionRepo(session).get_by_number(customer_id, extension_number)


async def get_by_id(session: AsyncSession, extension_id: uuid.UUID) -> Extension | None:
    return await ExtensionRepo(session).get_by_id(extension_id)


async def get_by_sip_username_global(session: AsyncSession, sip_username: str) -> Extension | None:
    return await ExtensionRepo(session).get_by_sip_username_global(sip_username)


async def get_used_numbers(session: AsyncSession, customer_id: uuid.UUID) -> set[str]:
    return await ExtensionRepo(session).get_used_numbers(customer_id)


async def get_all_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[Extension]:
    return await ExtensionRepo(session).get_all_for_customer(customer_id)


async def create_many(
    session: AsyncSession,
    customer_id: uuid.UUID,
    extensions: list[ExtensionCreate],
) -> list[Extension]:
    return await ExtensionRepo(session).create_many(customer_id, extensions)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    extension_number: str,
    sip_username: str,
    sip_credential_sid: str | None,
    sip_domain_sid: str | None,
    sip_password_encrypted: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
) -> Extension:
    return await ExtensionRepo(session).create(
        customer_id=customer_id,
        extension_number=extension_number,
        sip_username=sip_username,
        sip_credential_sid=sip_credential_sid,
        sip_domain_sid=sip_domain_sid,
        sip_password_encrypted=sip_password_encrypted,
        first_name=first_name,
        last_name=last_name,
    )


async def deactivate(session: AsyncSession, ext: Extension) -> Extension:
    return await ExtensionRepo(session).deactivate(ext)


async def provision(
    session: AsyncSession,
    engine: CallEngineProvider,
    *,
    customer_id: uuid.UUID,
    extension_number: str,
    sip_username: str,
    password: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
) -> Extension:
    plaintext = password or secrets.token_urlsafe(24)
    encrypted = encrypt_secret(plaintext)
    provisioned = await engine.provision_sip_client(sip_username, plaintext)
    try:
        return await ExtensionRepo(session).create(
            customer_id=customer_id,
            extension_number=extension_number,
            sip_username=sip_username,
            sip_credential_sid=provisioned.client_sid,
            sip_domain_sid=provisioned.sip_realm,
            sip_password_encrypted=encrypted,
            first_name=first_name,
            last_name=last_name,
        )
    except Exception:
        await session.rollback()
        await engine.deprovision_sip_client(provisioned.client_sid)
        raise


async def provision_many(
    session: AsyncSession,
    engine: CallEngineProvider,
    *,
    customer_id: uuid.UUID,
    extensions: list[tuple[str, str]],
    first_name: str | None = None,
    last_name: str | None = None,
) -> list[Extension]:
    prepared: list[ExtensionCreate] = []
    try:
        for extension_number, sip_username in extensions:
            plaintext = secrets.token_urlsafe(24)
            encrypted = encrypt_secret(plaintext)
            provisioned = await engine.provision_sip_client(sip_username, plaintext)
            prepared.append(
                ExtensionCreate(
                    extension_number=extension_number,
                    sip_username=sip_username,
                    sip_credential_sid=provisioned.client_sid,
                    sip_domain_sid=provisioned.sip_realm,
                    sip_password_encrypted=encrypted,
                    first_name=first_name,
                    last_name=last_name,
                )
            )
        return await ExtensionRepo(session).create_many(customer_id, prepared)
    except Exception:
        await session.rollback()
        for item in reversed(prepared):
            try:
                await engine.deprovision_sip_client(item.sip_credential_sid)
            except Exception:
                logger.exception(
                    "Failed to compensate SIP client provisioning client_sid=%s",
                    item.sip_credential_sid,
                )
        raise


async def deactivate_provisioned(
    session: AsyncSession, engine: CallEngineProvider, ext: Extension
) -> Extension:
    if ext.sip_credential_sid:
        await engine.deprovision_sip_client(ext.sip_credential_sid)
    return await ExtensionRepo(session).deactivate(ext)


async def assign_branch(session: AsyncSession, ext: Extension, branch_id: int | None) -> Extension:
    return await ExtensionRepo(session).assign_branch(ext, branch_id)


async def issue_webphone_credential(
    session: AsyncSession,
    engine: CallEngineProvider,
    ext: Extension,
    *,
    rotate: bool = False,
) -> WebphoneCredential:
    """Return the SIP credential a browser softphone registers this extension with.

    The stored password is reused when there is one, so opening the phone in a second
    tab — or reloading it — does not invalidate the first. When the row holds no
    password (the ordinary case: ``AccountData`` erases it after its one-time
    delivery) or ``rotate`` is set, a new one is generated, pushed to the call engine
    under the *same* SIP username, and stored.

    Rotation is what revocation looks like here: any client still holding the old
    password — a desk phone, a copy of Zoiper — stops registering, by design.
    """
    if not ext.sip_domain_sid or not ext.sip_credential_sid:
        raise WebphoneCredentialError("Extension has no provisioned SIP client")

    # Bind the realm before the row is refreshed below: `set_password` returns a
    # re-read Extension, which widens these back to `str | None`.
    realm = ext.sip_domain_sid
    client_sid = ext.sip_credential_sid

    encrypted = ext.sip_password_encrypted
    if rotate or not encrypted:
        plaintext = secrets.token_urlsafe(24)
        await engine.update_sip_client_password(client_sid, plaintext)
        ext = await ExtensionRepo(session).set_password(ext, encrypt_secret(plaintext))
        logger.info(
            "Webphone credential issued extension_id=%s rotated=True",
            ext.id,
        )
    else:
        plaintext = decrypt_secret(encrypted)
        logger.info("Webphone credential issued extension_id=%s rotated=False", ext.id)

    return WebphoneCredential(
        sip_username=ext.sip_username,
        sip_password=plaintext,
        sip_realm=realm,
        ws_uri=webphone_ws_uri(realm),
    )


async def consume_account_credentials(
    session: AsyncSession, customer_id: uuid.UUID
) -> list[DeliveredSipCredential]:
    rows = await ExtensionRepo(session).get_undelivered_credentials(customer_id)
    credentials = [
        DeliveredSipCredential(
            first_name=row.first_name or "",
            last_name=row.last_name or "",
            extension=row.extension_number,
            sip_username=row.sip_username,
            sip_password=decrypt_secret(row.sip_password_encrypted or ""),
            sip_domain=row.sip_domain_sid or "",
        )
        for row in rows
    ]
    await ExtensionRepo(session).mark_credentials_delivered(rows)
    return credentials
