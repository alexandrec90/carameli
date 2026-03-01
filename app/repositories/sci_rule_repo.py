from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sci_rule import SciRule


class SciRuleRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def upsert(
        self,
        customer_id: uuid.UUID,
        extension_id: uuid.UUID,
        zip_code: str,
        enabled: bool,
    ) -> SciRule:
        result = await self.session.execute(
            select(SciRule).where(
                SciRule.customer_id == customer_id,
                SciRule.extension_id == extension_id,
                SciRule.zip_code == zip_code,
            )
        )
        rule = result.scalar_one_or_none()
        if rule:
            rule.enabled = enabled
        else:
            rule = SciRule(
                customer_id=customer_id,
                extension_id=extension_id,
                zip_code=zip_code,
                enabled=enabled,
            )
            self.session.add(rule)
        await self.session.commit()
        await self.session.refresh(rule)
        return rule

    async def get_enabled_for_extension(
        self, extension_id: uuid.UUID
    ) -> list[SciRule]:
        """Return all enabled SCI rules for an extension (used for inbound call filtering)."""
        result = await self.session.execute(
            select(SciRule).where(
                SciRule.extension_id == extension_id,
                SciRule.enabled.is_(True),
            )
        )
        return list(result.scalars().all())

    async def update_extension_option(
        self, customer_id: uuid.UUID, extension_id: uuid.UUID, enabled: bool
    ) -> list[SciRule]:
        result = await self.session.execute(
            select(SciRule).where(
                SciRule.customer_id == customer_id,
                SciRule.extension_id == extension_id,
            )
        )
        rules = list(result.scalars().all())
        for rule in rules:
            rule.enabled = enabled
        await self.session.commit()
        return rules
