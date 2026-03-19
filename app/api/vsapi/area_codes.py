from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.auth import verify_api_key
from app.schemas.area_code import AreaCodeInfo, AreaCodesResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["area-codes"])


@router.get(
    "/GetAreaCodes",
    response_model=AreaCodesResponse,
    responses={502: {"description": "Provider error"}},
)
async def get_area_codes(
    request: Request,
    _: Annotated[str, Depends(verify_api_key)],
) -> AreaCodesResponse:
    """Return all US area codes available from the active carrier provider."""
    logger.info("Fetching US area codes")
    carrier = request.app.state.carrier
    try:
        codes = await carrier.get_available_area_codes(country="US")
    except Exception as exc:
        logger.error("Provider error fetching area codes: %s", exc)
        raise HTTPException(status_code=502, detail="Provider error fetching area codes") from None
    items = [AreaCodeInfo(area_code=c["area_code"], country=c["country"]) for c in codes]
    logger.info("Returned %d area codes", len(items))
    return AreaCodesResponse(area_codes=items, count=len(items))


@router.get(
    "/GetAreaCodes/{country}/{state}",
    response_model=AreaCodesResponse,
    responses={502: {"description": "Provider error"}},
)
async def get_area_codes_filtered(
    country: str,
    state: str,
    request: Request,
    _: Annotated[str, Depends(verify_api_key)],
) -> AreaCodesResponse:
    """Return area codes filtered by country and state."""
    carrier = request.app.state.carrier
    try:
        codes = await carrier.get_available_area_codes(country=country.upper(), state=state.upper())
    except Exception:
        raise HTTPException(status_code=502, detail="Provider error fetching area codes") from None
    items = [AreaCodeInfo(area_code=c["area_code"], country=c["country"]) for c in codes]
    return AreaCodesResponse(area_codes=items, count=len(items))
