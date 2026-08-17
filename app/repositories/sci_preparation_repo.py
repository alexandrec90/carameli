from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sci_preparation import SciPreparation


def _utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class SciPreparationRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def upsert(
        self,
        *,
        customer_id: uuid.UUID,
        extension_id: uuid.UUID,
        contact_id: int,
        destination_number: str,
        candidate_area_codes: list[str],
        selected_phone_line_id: uuid.UUID,
        selected_caller_id: str,
        expires_at: datetime,
    ) -> SciPreparation:
        result = await self.session.execute(
            select(SciPreparation).where(
                SciPreparation.customer_id == customer_id,
                SciPreparation.contact_id == contact_id,
            )
        )
        row = result.scalar_one_or_none()
        values = {
            "extension_id": extension_id,
            "destination_number": destination_number,
            "candidate_area_codes": candidate_area_codes,
            "selected_phone_line_id": selected_phone_line_id,
            "selected_caller_id": selected_caller_id,
            "expires_at": expires_at,
            "consumed_at": None,
        }
        if row:
            for key, value in values.items():
                setattr(row, key, value)
        else:
            row = SciPreparation(
                customer_id=customer_id,
                contact_id=contact_id,
                **values,
            )
            self.session.add(row)
        await self.session.commit()
        await self.session.refresh(row)
        return row

    async def claim(
        self,
        *,
        customer_id: uuid.UUID,
        extension_id: uuid.UUID,
        contact_id: int,
        destination_number: str,
    ) -> SciPreparation | None:
        now = _utcnow_naive()
        result = await self.session.execute(
            select(SciPreparation)
            .where(
                SciPreparation.customer_id == customer_id,
                SciPreparation.extension_id == extension_id,
                SciPreparation.contact_id == contact_id,
                SciPreparation.destination_number == destination_number,
                SciPreparation.consumed_at.is_(None),
                SciPreparation.expires_at > now,
            )
            .with_for_update()
        )
        row = result.scalar_one_or_none()
        return row

    async def mark_consumed(self, row: SciPreparation) -> None:
        row.consumed_at = _utcnow_naive()
