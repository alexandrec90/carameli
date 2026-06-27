from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.models.audio_asset import AudioAsset
from app.schemas.audio_asset import (
    AudioAssetListResponse,
    AudioAssetResponse,
    ConfirmAudioAssetRequest,
    PresignedUploadRequest,
    PresignedUploadResponse,
)
from app.services import audio_asset_service, customer_service, s3_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsAudio", tags=["audio-assets"])


def _to_response(asset: AudioAsset, playback_url: str | None) -> AudioAssetResponse:
    return AudioAssetResponse(
        id=asset.id,
        customer_id=asset.customer_id,
        kind=asset.kind,
        name=asset.name,
        s3_key=asset.s3_key,
        playback_url=playback_url,
        duration_seconds=asset.duration_seconds,
        active=asset.active,
        created_at=asset.created_at,
    )


@router.get(
    "/List/{customerId}",
    response_model=AudioAssetListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_audio_assets(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    kind: Annotated[str | None, Query(max_length=32)] = None,
) -> AudioAssetListResponse:
    """List a customer's audio assets, optionally filtered by kind."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing audio assets vs_customer_id=%s kind=%s", customerId, kind)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    assets = await audio_asset_service.list_for_customer(session, customer.id, kind=kind)
    return AudioAssetListResponse(
        assets=[_to_response(a, s3_service.get_presigned_download_url(a.s3_key)) for a in assets],
        vs_customer_id=customerId,
    )


@router.post(
    "/PresignedUpload",
    response_model=PresignedUploadResponse,
    responses={
        404: {"description": "Customer not found"},
        503: {"description": "S3 storage not configured"},
    },
)
async def presigned_upload(
    body: PresignedUploadRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PresignedUploadResponse:
    """Issue a presigned S3 PUT URL so the browser can upload audio bytes directly."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Presigned upload requested vs_customer_id=%s kind=%s name=%s",
        body.vs_customer_id,
        body.kind,
        body.name,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    s3_key = f"audio/{customer.id}/{uuid.uuid4()}"
    upload_url = s3_service.get_presigned_upload_url(s3_key, body.content_type)
    if not upload_url:
        logger.warning("S3 not configured vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=503, detail="S3 storage not configured")
    logger.info(
        "Presigned upload URL issued vs_customer_id=%s s3_key=%s", body.vs_customer_id, s3_key
    )
    return PresignedUploadResponse(upload_url=upload_url, s3_key=s3_key)


@router.post(
    "/ConfirmUpload",
    status_code=201,
    response_model=AudioAssetResponse,
    responses={404: {"description": "Customer not found"}},
)
async def confirm_upload(
    body: ConfirmAudioAssetRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> AudioAssetResponse:
    """Record audio asset metadata after a successful S3 upload."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Confirming audio upload vs_customer_id=%s kind=%s name=%s",
        body.vs_customer_id,
        body.kind,
        body.name,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    asset = await audio_asset_service.create(
        session,
        customer_id=customer.id,
        kind=body.kind,
        name=body.name,
        s3_key=body.s3_key,
        duration_seconds=body.duration_seconds,
    )
    logger.info(
        "Audio asset created id=%s vs_customer_id=%s kind=%s",
        asset.id,
        body.vs_customer_id,
        body.kind,
    )
    return _to_response(asset, s3_service.get_presigned_download_url(asset.s3_key))


@router.put(
    "/Deactivate/{customerId}/{assetId}",
    response_model=AudioAssetResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_audio_asset(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    assetId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> AudioAssetResponse:
    """Soft-delete a customer's audio asset."""
    enforce_customer_scope(auth, customerId)
    logger.info("Deactivating audio asset vs_customer_id=%s asset_id=%s", customerId, assetId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    asset = await audio_asset_service.get_for_customer(session, assetId, customer.id)
    if not asset:
        logger.warning("Audio asset not found vs_customer_id=%s asset_id=%s", customerId, assetId)
        raise HTTPException(status_code=404, detail="Audio asset not found")
    asset = await audio_asset_service.deactivate(session, asset)
    logger.info("Audio asset deactivated id=%s vs_customer_id=%s", asset.id, customerId)
    return _to_response(asset, None)
