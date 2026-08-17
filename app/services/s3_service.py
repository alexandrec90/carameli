from __future__ import annotations

import logging
from typing import Protocol

from app.core.config import settings

logger = logging.getLogger(__name__)

_client: object | None = None


class S3StorageError(RuntimeError):
    pass


class UploadFile(Protocol):
    def read(self, size: int = -1) -> bytes:
        del size
        raise NotImplementedError

    def seek(self, offset: int, whence: int = 0) -> int:
        del offset, whence
        raise NotImplementedError


def _get_client() -> object | None:
    global _client
    if _client is None and settings.s3_access_key_id and settings.s3_bucket:
        try:
            import boto3  # type: ignore[import-untyped]

            kwargs: dict[str, str] = {
                "aws_access_key_id": settings.s3_access_key_id,
                "aws_secret_access_key": settings.s3_secret_access_key,
                "region_name": settings.s3_region,
            }
            if settings.s3_endpoint:
                kwargs["endpoint_url"] = settings.s3_endpoint
            _client = boto3.client("s3", **kwargs)
        except ImportError:
            logger.warning("boto3 not installed; S3 presigned URL generation disabled")
    return _client


def get_presigned_upload_url(s3_key: str, content_type: str, expires_in: int = 3600) -> str | None:
    """Return a presigned PUT URL for direct browser-to-S3 upload, or None if S3 is unconfigured."""
    client = _get_client()
    if client is None or not settings.s3_bucket:
        return None
    try:
        return client.generate_presigned_url(  # type: ignore[no-any-return, attr-defined]
            "put_object",
            Params={"Bucket": settings.s3_bucket, "Key": s3_key, "ContentType": content_type},
            ExpiresIn=expires_in,
        )
    except Exception as exc:
        logger.error("Failed to generate presigned upload URL s3_key=%s: %s", s3_key, exc)
        return None


def get_presigned_download_url(s3_key: str, expires_in: int = 3600) -> str | None:
    """Return a presigned GET URL for audio playback, or None if S3 is unconfigured."""
    client = _get_client()
    if client is None or not settings.s3_bucket:
        return None
    try:
        return client.generate_presigned_url(  # type: ignore[no-any-return, attr-defined]
            "get_object",
            Params={"Bucket": settings.s3_bucket, "Key": s3_key},
            ExpiresIn=expires_in,
        )
    except Exception as exc:
        logger.error("Failed to generate presigned download URL s3_key=%s: %s", s3_key, exc)
        return None


def is_configured() -> bool:
    return _get_client() is not None and bool(settings.s3_bucket)


def download_object(s3_key: str, max_bytes: int) -> bytes:
    client = _get_client()
    if client is None or not settings.s3_bucket:
        raise S3StorageError("S3 storage is not configured")
    head = client.head_object(Bucket=settings.s3_bucket, Key=s3_key)  # type: ignore[attr-defined]
    content_length = int(head.get("ContentLength", 0))
    if content_length > max_bytes:
        raise S3StorageError("Recording exceeds the configured archive file-size limit")
    response = client.get_object(Bucket=settings.s3_bucket, Key=s3_key)  # type: ignore[attr-defined]
    body = bytes(response["Body"].read(max_bytes + 1))
    if len(body) > max_bytes:
        raise S3StorageError("Recording exceeds the configured archive file-size limit")
    return body


def upload_fileobj(fileobj: UploadFile, s3_key: str, content_type: str) -> None:
    client = _get_client()
    if client is None or not settings.s3_bucket:
        raise S3StorageError("S3 storage is not configured")
    fileobj.seek(0)
    client.upload_fileobj(  # type: ignore[attr-defined]
        fileobj,
        settings.s3_bucket,
        s3_key,
        ExtraArgs={"ContentType": content_type},
    )
