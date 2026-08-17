from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audio_asset import AudioAsset
from app.repositories.audio_asset_repo import AudioAssetRepo


async def list_for_customer(
    session: AsyncSession, customer_id: uuid.UUID, kind: str | None = None
) -> list[AudioAsset]:
    return await AudioAssetRepo(session).list_for_customer(customer_id, kind=kind)


async def get_for_customer(
    session: AsyncSession, asset_id: uuid.UUID, customer_id: uuid.UUID
) -> AudioAsset | None:
    return await AudioAssetRepo(session).get_for_customer(asset_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    kind: str,
    name: str,
    s3_key: str,
    duration_seconds: int | None = None,
    voicemail_drop_code: int | None = None,
) -> AudioAsset:
    return await AudioAssetRepo(session).create(
        customer_id=customer_id,
        kind=kind,
        name=name,
        s3_key=s3_key,
        duration_seconds=duration_seconds,
        voicemail_drop_code=voicemail_drop_code,
    )


async def deactivate(session: AsyncSession, asset: AudioAsset) -> AudioAsset:
    return await AudioAssetRepo(session).deactivate(asset)


async def get_by_voicemail_drop_code(
    session: AsyncSession, customer_id: uuid.UUID, code: int
) -> AudioAsset | None:
    return await AudioAssetRepo(session).get_by_voicemail_drop_code(customer_id, code)
