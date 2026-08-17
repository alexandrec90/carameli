from __future__ import annotations

from typing import Annotated

from arq.connections import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.core.redis import get_arq_redis
from app.repositories.recording_archive_repo import RecordingArchiveRepo
from app.schemas.recording_archive import RecordingArchiveRequest, RecordingArchiveResponse
from app.services import customer_service, recording_archive_service, s3_service

router = APIRouter(prefix="/VsArchive", tags=["recording-archives"])


def _response(archive) -> RecordingArchiveResponse:
    return RecordingArchiveResponse(
        export_id=archive.export_id,
        archive_name=archive.archive_name,
        status=archive.status,
        file_count=archive.file_count,
        download_url=(
            s3_service.get_presigned_download_url(archive.s3_key) if archive.s3_key else None
        ),
        error=archive.error,
    )


@router.post(
    "",
    status_code=202,
    response_model=RecordingArchiveResponse,
    responses={404: {"description": "Customer or recording not found"}},
)
async def request_archive(
    body: RecordingArchiveRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    redis: Annotated[ArqRedis, Depends(get_arq_redis)],
) -> RecordingArchiveResponse:
    enforce_customer_scope(auth, body.vs_customer_id)
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if not s3_service.is_configured():
        raise HTTPException(status_code=503, detail="S3 storage not configured")
    existing = await RecordingArchiveRepo(session).get_by_export(customer.id, body.export_id)
    if existing:
        if existing.archive_name != body.archive_name or existing.file_count != len(body.files):
            raise HTTPException(status_code=409, detail="Export id already used by another archive")
        return _response(existing)
    try:
        items = await recording_archive_service.resolve_items(
            session, customer_id=customer.id, files=body.files
        )
    except recording_archive_service.ArchiveRequestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    archive, created = await recording_archive_service.create_archive(
        session,
        customer_id=customer.id,
        export_id=body.export_id,
        archive_name=body.archive_name,
        items=items,
    )
    if created:
        try:
            job = await redis.enqueue_job(
                "build_recording_archive",
                str(archive.id),
                _job_id=f"recording-archive:{archive.id}",
            )
        except Exception:
            await RecordingArchiveRepo(session).set_status(
                archive, "failed", error="Archive queue unavailable"
            )
            raise HTTPException(status_code=503, detail="Archive queue unavailable") from None
        if job is None:
            await RecordingArchiveRepo(session).set_status(
                archive, "failed", error="Archive queue rejected the job"
            )
            raise HTTPException(status_code=409, detail="Archive job already queued")
    return _response(archive)


@router.get(
    "/{customerId}/{exportId}",
    response_model=RecordingArchiveResponse,
    responses={404: {"description": "Customer or archive not found"}},
)
async def get_archive(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    exportId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> RecordingArchiveResponse:
    enforce_customer_scope(auth, customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    archive = await RecordingArchiveRepo(session).get_by_export(customer.id, exportId)
    if not archive:
        raise HTTPException(status_code=404, detail="Archive not found")
    return _response(archive)
