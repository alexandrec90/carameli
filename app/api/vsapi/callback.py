from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.config import settings
from app.core.database import get_session
from app.core.sip import agent_sip_uri
from app.schemas.callback import CallbackRequest, CallbackResponse
from app.services import customer_service, extension_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/Callback", tags=["callback"])


@router.post(
    "/ByExtension",
    response_model=CallbackResponse,
    status_code=200,
    responses={
        404: {"description": "Customer or extension not found"},
        502: {"description": "Call engine error"},
    },
)
async def callback_by_extension(
    body: CallbackRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> CallbackResponse:
    """Initiate a two-leg click-to-call: dial the agent extension first, then bridge to contact."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Callback/ByExtension vs_customer_id=%s extension=%s destination=%s",
        body.vs_customer_id,
        body.extension,
        body.destination_number,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    ext = await extension_service.get_by_number(session, customer.id, body.extension)
    if not ext:
        logger.warning(
            "Extension not found vs_customer_id=%s extension=%s",
            body.vs_customer_id,
            body.extension,
        )
        raise HTTPException(status_code=404, detail="Extension not found")

    webhook_url = f"{settings.jambonz_webhook_base_url}/webhooks/jambonz/callback-answered"

    engine = request.app.state.engine
    try:
        result = await engine.initiate_callback(
            agent_sip_uri=agent_sip_uri(ext.sip_username, ext.sip_domain_sid),
            contact_number=body.destination_number,
            webhook_url=webhook_url,
        )
    except Exception as exc:
        logger.error(
            "Call engine error during callback vs_customer_id=%s extension=%s: %s",
            body.vs_customer_id,
            body.extension,
            exc,
        )
        raise HTTPException(status_code=502, detail="Call engine error") from None

    logger.info(
        "Callback initiated call_sid=%s vs_customer_id=%s extension=%s",
        result.get("call_id"),
        body.vs_customer_id,
        body.extension,
    )
    return CallbackResponse(call_sid=result["call_id"], status=result["status"])
