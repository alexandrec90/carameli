from __future__ import annotations

import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

_client: object | None = None


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
        return client.generate_presigned_url(  # type: ignore[union-attr]
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
        return client.generate_presigned_url(  # type: ignore[union-attr]
            "get_object",
            Params={"Bucket": settings.s3_bucket, "Key": s3_key},
            ExpiresIn=expires_in,
        )
    except Exception as exc:
        logger.error("Failed to generate presigned download URL s3_key=%s: %s", s3_key, exc)
        return None
