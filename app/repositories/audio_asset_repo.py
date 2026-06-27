from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audio_asset import AudioAsset


class AudioAssetRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        kind: str,
        name: str,
        s3_key: str,
        duration_seconds: int | None = None,
    ) -> AudioAsset:
        asset = AudioAsset(
            customer_id=customer_id,
            kind=kind,
            name=name,
            s3_key=s3_key,
            duration_seconds=duration_seconds,
        )
        self.session.add(asset)
        await self.session.commit()
        await self.session.refresh(asset)
        return asset

    async def list_for_customer(
        self, customer_id: uuid.UUID, kind: str | None = None
    ) -> list[AudioAsset]:
        stmt = (
            select(AudioAsset)
            .where(AudioAsset.customer_id == customer_id, AudioAsset.active.is_(True))
            .order_by(AudioAsset.created_at.desc())
        )
        if kind is not None:
            stmt = stmt.where(AudioAsset.kind == kind)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_for_customer(
        self, asset_id: uuid.UUID, customer_id: uuid.UUID
    ) -> AudioAsset | None:
        result = await self.session.execute(
            select(AudioAsset).where(
                AudioAsset.id == asset_id,
                AudioAsset.customer_id == customer_id,
                AudioAsset.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, asset: AudioAsset) -> AudioAsset:
        asset.active = False
        await self.session.commit()
        await self.session.refresh(asset)
        return asset
