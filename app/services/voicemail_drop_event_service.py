from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.voicemail_drop_event import VoicemailDropEvent
from app.repositories.voicemail_drop_event_repo import VoicemailDropEventRepo


async def list_for_customer(
    session: AsyncSession, customer_id: uuid.UUID
) -> list[VoicemailDropEvent]:
    return await VoicemailDropEventRepo(session).list_for_customer(customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    to_number: str,
    status: str,
    call_sid: str | None = None,
    audio_asset_id: uuid.UUID | None = None,
) -> VoicemailDropEvent:
    return await VoicemailDropEventRepo(session).create(
        customer_id=customer_id,
        to_number=to_number,
        status=status,
        call_sid=call_sid,
        audio_asset_id=audio_asset_id,
    )
