from __future__ import annotations

import logging

from app.core.config import settings
from app.core.database import async_session_factory
from app.repositories.customer_repo import CustomerRepo
from app.repositories.sms_message_repo import SmsMessageRepo
from app.services import crm_notify

logger = logging.getLogger(__name__)


async def retry_unposted_sms_messages(ctx: dict) -> None:
    """Retry forwarding inbound SMS (older than 1 min) that failed the first POST."""
    if not settings.crm_webhook_url:
        return

    async with async_session_factory() as session:
        repo = SmsMessageRepo(session)
        messages = await repo.get_unposted_inbound()
        if not messages:
            return

        logger.info("Found %d unposted inbound SMS messages; retrying…", len(messages))
        customer_repo = CustomerRepo(session)

        for message in messages:
            try:
                vs_customer_id = None
                if message.customer_id:
                    customer = await customer_repo.get_by_id(message.customer_id)
                    vs_customer_id = customer.vs_customer_id if customer else None

                posted = await crm_notify.post_notification(
                    crm_notify.INCOMING_SMS_PATH,
                    crm_notify.sms_message_payload(message, vs_customer_id),
                )
                if posted:
                    await repo.mark_posted(message.id)
                    logger.info("Retry: forwarded inbound SMS %s to CRM", message.message_sid)
            except Exception:
                logger.exception("Retry: failed to forward inbound SMS %s", message.message_sid)
