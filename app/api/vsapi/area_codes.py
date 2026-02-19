from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from twilio.base.exceptions import TwilioRestException

from app.core.auth import verify_api_key
from app.schemas.area_code import AreaCodeInfo, AreaCodesResponse
from app.services.twilio_provider import TwilioProvider

router = APIRouter(tags=["area-codes"])


@router.get("/GetAreaCodes", response_model=AreaCodesResponse)
async def get_area_codes(
    request: Request,
    _: Annotated[str, Depends(verify_api_key)],
) -> AreaCodesResponse:
    """Return all US area codes available from Twilio."""
    provider: TwilioProvider = request.app.state.twilio
    try:
        codes = await provider.get_available_area_codes(country="US")
    except TwilioRestException as exc:
        raise HTTPException(status_code=502, detail=f"Twilio error: {exc.msg}")
    items = [AreaCodeInfo(area_code=c["area_code"], country=c["country"]) for c in codes]
    return AreaCodesResponse(area_codes=items, count=len(items))


@router.get("/GetAreaCodes/{country}/{state}", response_model=AreaCodesResponse)
async def get_area_codes_filtered(
    country: str,
    state: str,
    request: Request,
    _: Annotated[str, Depends(verify_api_key)],
) -> AreaCodesResponse:
    """Return area codes filtered by country and state."""
    provider: TwilioProvider = request.app.state.twilio
    try:
        codes = await provider.get_available_area_codes(
            country=country.upper(), state=state.upper()
        )
    except TwilioRestException as exc:
        raise HTTPException(status_code=502, detail=f"Twilio error: {exc.msg}")
    items = [AreaCodeInfo(area_code=c["area_code"], country=c["country"]) for c in codes]
    return AreaCodesResponse(area_codes=items, count=len(items))
