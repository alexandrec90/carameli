from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extension import Extension

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ExtensionCreate:
    extension_number: str
    sip_username: str
    sip_credential_sid: str
    sip_domain_sid: str
    sip_password_encrypted: str
    first_name: str | None = None
    last_name: str | None = None


class ExtensionRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        extension_number: str,
        sip_username: str,
        sip_credential_sid: str | None = None,
        sip_domain_sid: str | None = None,
        sip_password_encrypted: str | None = None,
        first_name: str | None = None,
        last_name: str | None = None,
    ) -> Extension:
        ext = Extension(
            customer_id=customer_id,
            extension_number=extension_number,
            sip_username=sip_username,
            sip_credential_sid=sip_credential_sid,
            sip_domain_sid=sip_domain_sid,
            sip_password_encrypted=sip_password_encrypted,
            first_name=first_name,
            last_name=last_name,
        )
        self.session.add(ext)
        await self.session.commit()
        await self.session.refresh(ext)
        return ext

    async def create_many(
        self,
        customer_id: uuid.UUID,
        extensions: list[ExtensionCreate],
    ) -> list[Extension]:
        """Create every ``(extension_number, sip_username)`` pair in one transaction.

        The legacy client looped a single-create call over a start..end range and
        returned failure on the first error, leaving extensions 1..k created and
        reporting total failure. One commit for the whole range makes that partial
        state impossible.
        """
        rows = [
            Extension(
                customer_id=customer_id,
                extension_number=item.extension_number,
                sip_username=item.sip_username,
                sip_credential_sid=item.sip_credential_sid,
                sip_domain_sid=item.sip_domain_sid,
                sip_password_encrypted=item.sip_password_encrypted,
                first_name=item.first_name,
                last_name=item.last_name,
            )
            for item in extensions
        ]
        self.session.add_all(rows)
        await self.session.commit()
        for row in rows:
            await self.session.refresh(row)
        return rows

    async def get_by_number(
        self, customer_id: uuid.UUID, extension_number: str
    ) -> Extension | None:
        result = await self.session.execute(
            select(Extension).where(
                Extension.customer_id == customer_id,
                Extension.extension_number == extension_number,
                Extension.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_sip_username_global(self, sip_username: str) -> Extension | None:
        """Look up an active extension by SIP username across every customer.

        Unscoped on purpose: a device-originated call hook identifies the caller
        only by the SIP username it registered with, and that username already
        embeds the customer it belongs to. The caller is responsible for scoping
        anything it does afterwards to ``extension.customer_id``.
        """
        result = await self.session.execute(
            select(Extension).where(
                Extension.sip_username == sip_username,
                Extension.active.is_(True),
            )
        )
        return result.scalars().first()

    async def get_all_for_customer(self, customer_id: uuid.UUID) -> list[Extension]:
        result = await self.session.execute(
            select(Extension).where(
                Extension.customer_id == customer_id,
                Extension.active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def get_used_numbers(self, customer_id: uuid.UUID) -> set[str]:
        result = await self.session.execute(
            select(Extension.extension_number).where(
                Extension.customer_id == customer_id,
                Extension.active.is_(True),
            )
        )
        return {row[0] for row in result.all()}

    async def get_all_active(self) -> list[Extension]:
        """Return every active extension across all customers (used by the cron poller)."""
        result = await self.session.execute(select(Extension).where(Extension.active.is_(True)))
        return list(result.scalars().all())

    async def get_by_id(self, extension_id: uuid.UUID) -> Extension | None:
        result = await self.session.execute(
            select(Extension).where(
                Extension.id == extension_id,
                Extension.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, ext: Extension) -> Extension:
        ext.active = False
        await self.session.commit()
        await self.session.refresh(ext)
        return ext

    async def assign_branch(self, ext: Extension, branch_id: int | None) -> Extension:
        ext.branch_id = branch_id
        await self.session.commit()
        await self.session.refresh(ext)
        return ext

    async def get_undelivered_credentials(self, customer_id: uuid.UUID) -> list[Extension]:
        result = await self.session.execute(
            select(Extension)
            .where(
                Extension.customer_id == customer_id,
                Extension.active.is_(True),
                Extension.sip_password_encrypted.is_not(None),
                Extension.sip_secret_delivered_at.is_(None),
            )
            .order_by(Extension.extension_number)
            .with_for_update()
        )
        return list(result.scalars().all())

    async def set_password(self, ext: Extension, encrypted: str) -> Extension:
        """Store a re-issued SIP password.

        Also clears ``sip_secret_delivered_at``: the row holds a live secret again,
        and leaving the stamp set would make an already-delivered extension look
        like one whose password had been erased.
        """
        ext.sip_password_encrypted = encrypted
        ext.sip_secret_delivered_at = None
        await self.session.commit()
        await self.session.refresh(ext)
        return ext

    async def mark_credentials_delivered(self, extensions: list[Extension]) -> None:
        delivered_at = datetime.now(UTC).replace(tzinfo=None)
        for ext in extensions:
            ext.sip_secret_delivered_at = delivered_at
            ext.sip_password_encrypted = None
