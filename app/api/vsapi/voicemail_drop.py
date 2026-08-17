from __future__ import annotations

import logging
from typing import Annotated, cast

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.config import settings
from app.core.database import get_session
from app.core.limiter import limiter
from app.schemas.voicemail import VoicemailDropRequest, VoicemailDropResponse
from app.services import (
    audio_asset_service,
    call_event_service,
    customer_service,
    extension_service,
    s3_service,
    voicemail_drop_event_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["voicemail-drop"])


@router.post(
    "/VsMessageDrop",
    response_model=VoicemailDropResponse,
    responses={
        400: {"description": "Bad request"},
        404: {"description": "Customer not found"},
        502: {"description": "Provider error"},
    },
)
@limiter.limit(settings.rate_limit_calls)
async def voicemail_drop(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    body: Annotated[VoicemailDropRequest | None, Body()] = None,
    vscustomerId: Annotated[int | None, Query(ge=1, le=2147483647)] = None,
    extension: Annotated[str | None, Query(min_length=1, max_length=64)] = None,
    msgDropNumber: Annotated[int | None, Query(ge=1, le=9)] = None,
) -> VoicemailDropResponse:
    """Initiate a JSON-body drop or resolve a legacy code onto an active call."""
    legacy_values = (vscustomerId, extension, msgDropNumber)
    if body is not None and any(value is not None for value in legacy_values):
        raise HTTPException(status_code=400, detail="Do not mix body and legacy query parameters")
    if body is None:
        if any(value is None for value in legacy_values):
            raise HTTPException(status_code=400, detail="Incomplete voicemail drop request")
        return await _legacy_voicemail_drop(
            request=request,
            session=session,
            auth=auth,
            vs_customer_id=cast(int, vscustomerId),
            extension=cast(str, extension),
            code=cast(int, msgDropNumber),
        )

    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Voicemail drop vs_customer_id=%s to=%s from=%s",
        body.vs_customer_id,
        body.msg_drop_number,
        body.extension,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    engine = request.app.state.engine
    try:
        result = await engine.initiate_voicemail_drop(
            to=body.msg_drop_number,
            from_=body.extension,
            audio_url=str(body.audio_url),
        )
    except Exception as exc:
        logger.error(
            "Provider error initiating voicemail drop vs_customer_id=%s to=%s: %s",
            body.vs_customer_id,
            body.msg_drop_number,
            exc,
        )
        raise HTTPException(
            status_code=502, detail="Provider error initiating voicemail drop"
        ) from None

    logger.info(
        "Voicemail drop initiated call_sid=%s status=%s",
        result["call_id"],
        result["status"],
    )
    try:
        await voicemail_drop_event_service.create(
            session,
            customer_id=customer.id,
            to_number=body.msg_drop_number,
            status=result["status"],
            call_sid=result["call_id"],
        )
    except Exception as exc:
        logger.error("Failed to persist voicemail drop event: %s", exc)
    return VoicemailDropResponse(call_sid=result["call_id"], status=result["status"])


def _call_matches_sip_username(call: dict, sip_username: str) -> bool:
    for key in ("from", "to", "sip_user", "sipUser"):
        value = str(call.get(key) or "").strip()
        user = value.removeprefix("sip:").split("@", 1)[0]
        if user == sip_username:
            return True
    return False


async def _legacy_voicemail_drop(
    *,
    request: Request,
    session: AsyncSession,
    auth: AuthContext,
    vs_customer_id: int,
    extension: str,
    code: int,
) -> VoicemailDropResponse:
    enforce_customer_scope(auth, vs_customer_id)
    customer = await customer_service.get_by_vs_id(session, vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    ext = await extension_service.get_by_number(session, customer.id, extension)
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")
    asset = await audio_asset_service.get_by_voicemail_drop_code(session, customer.id, code)
    if not asset:
        raise HTTPException(status_code=404, detail="Voicemail drop code not found")
    audio_url = s3_service.get_presigned_download_url(asset.s3_key)
    if not audio_url:
        raise HTTPException(status_code=503, detail="Audio storage not configured")

    engine = request.app.state.engine
    try:
        calls = await engine.get_active_calls()
        active_ids = {
            str(value)
            for call in calls
            for value in (call.get("call_sid"), call.get("sid"), call.get("parent_call_sid"))
            if value
        }
        tracked = await call_event_service.get_active_for_extension(session, customer.id, extension)
        call_sids = {event.call_sid for event in tracked if event.call_sid in active_ids}
        if not call_sids:
            call_sids = {
                str(call.get("parent_call_sid") or call.get("call_sid") or call.get("sid"))
                for call in calls
                if _call_matches_sip_username(call, ext.sip_username)
                and (call.get("parent_call_sid") or call.get("call_sid") or call.get("sid"))
            }
        if not call_sids:
            raise HTTPException(status_code=404, detail="No active call for extension")
        if len(call_sids) > 1:
            raise HTTPException(status_code=409, detail="Multiple active calls for extension")
        call_sid = call_sids.pop()
        result = await engine.play_audio_to_call(call_sid, audio_url)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "Provider error playing voicemail drop vs_customer_id=%s extension=%s: %s",
            vs_customer_id,
            extension,
            exc,
        )
        raise HTTPException(
            status_code=502, detail="Provider error playing voicemail drop"
        ) from None

    await voicemail_drop_event_service.create(
        session,
        customer_id=customer.id,
        to_number=extension,
        status=result.get("status", "playing"),
        call_sid=call_sid,
        audio_asset_id=asset.id,
    )
    return VoicemailDropResponse(call_sid=call_sid, status=result.get("status", "playing"))
