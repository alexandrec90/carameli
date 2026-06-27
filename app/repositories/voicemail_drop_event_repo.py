from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.voicemail_drop_event import VoicemailDropEvent


class VoicemailDropEventRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        to_number: str,
        status: str,
        call_sid: str | None = None,
        audio_asset_id: uuid.UUID | None = None,
    ) -> VoicemailDropEvent:
        event = VoicemailDropEvent(
            customer_id=customer_id,
            to_number=to_number,
            status=status,
            call_sid=call_sid,
            audio_asset_id=audio_asset_id,
        )
        self.session.add(event)
        await self.session.commit()
        await self.session.refresh(event)
        return event

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[VoicemailDropEvent]:
        result = await self.session.execute(
            select(VoicemailDropEvent)
            .where(VoicemailDropEvent.customer_id == customer_id)
            .order_by(VoicemailDropEvent.created_at.desc())
        )
        return list(result.scalars().all())
