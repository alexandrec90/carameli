"""Integration tests for S3-compatible (MinIO) recording storage.

These tests hit a real MinIO instance. They are skipped automatically when
MinIO is not reachable (e.g. Docker is not running).

Run:
    docker compose exec app pytest tests/integration/test_s3_storage.py -v

Or from the host (MinIO must be reachable at localhost:9000):
    S3_ENDPOINT=http://localhost:9000 pytest tests/integration/test_s3_storage.py -v
"""

from __future__ import annotations

import io
import os
import uuid

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")

# ---------------------------------------------------------------------------
# Resolve MinIO endpoint: tests on host use localhost, inside Docker use minio
# ---------------------------------------------------------------------------

_S3_ENDPOINT = os.environ.get("S3_ENDPOINT", "http://localhost:9000")
_S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY_ID", "minioadmin")
_S3_SECRET_KEY = os.environ.get("S3_SECRET_ACCESS_KEY", "minioadmin")
_S3_BUCKET = os.environ.get("S3_BUCKET", "carameli-recordings")
_S3_REGION = os.environ.get("S3_REGION", "us-east-1")


def _get_s3_client():
    """Create a boto3 S3 client pointed at the MinIO endpoint."""
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=_S3_ENDPOINT,
        aws_access_key_id=_S3_ACCESS_KEY,
        aws_secret_access_key=_S3_SECRET_KEY,
        region_name=_S3_REGION,
        config=Config(signature_version="s3v4"),
    )


def _minio_reachable() -> bool:
    """Return True if the MinIO health endpoint responds."""
    try:
        client = _get_s3_client()
        client.head_bucket(Bucket=_S3_BUCKET)
        return True
    except Exception:
        return False


skip_no_minio = pytest.mark.skipif(
    not _minio_reachable(),
    reason=f"MinIO not reachable at {_S3_ENDPOINT} (is Docker running?)",
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def s3_client():
    return _get_s3_client()


@pytest.fixture
def unique_key():
    """Generate a unique S3 object key for test isolation."""
    return f"test-recordings/{uuid.uuid4()}.wav"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@skip_no_minio
def test_upload_and_download_recording(s3_client, unique_key):
    """Upload a fake recording file and read it back."""
    body = b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 100  # minimal WAV-ish bytes

    s3_client.upload_fileobj(
        io.BytesIO(body),
        _S3_BUCKET,
        unique_key,
        ExtraArgs={"ContentType": "audio/wav"},
    )

    resp = s3_client.get_object(Bucket=_S3_BUCKET, Key=unique_key)
    downloaded = resp["Body"].read()

    assert downloaded == body
    assert resp["ContentType"] == "audio/wav"

    # Cleanup
    s3_client.delete_object(Bucket=_S3_BUCKET, Key=unique_key)


@skip_no_minio
def test_delete_recording(s3_client, unique_key):
    """Deleting a recording object removes it from storage."""
    s3_client.put_object(Bucket=_S3_BUCKET, Key=unique_key, Body=b"delete-me")
    s3_client.delete_object(Bucket=_S3_BUCKET, Key=unique_key)

    with pytest.raises(s3_client.exceptions.NoSuchKey):
        s3_client.get_object(Bucket=_S3_BUCKET, Key=unique_key)


@skip_no_minio
def test_list_recordings_by_prefix(s3_client):
    """List objects under a call-specific prefix."""
    prefix = f"test-recordings/{uuid.uuid4()}/"
    keys = [f"{prefix}part-{i}.wav" for i in range(3)]

    for key in keys:
        s3_client.put_object(Bucket=_S3_BUCKET, Key=key, Body=b"data")

    resp = s3_client.list_objects_v2(Bucket=_S3_BUCKET, Prefix=prefix)
    listed_keys = [obj["Key"] for obj in resp.get("Contents", [])]

    assert sorted(listed_keys) == sorted(keys)

    # Cleanup
    for key in keys:
        s3_client.delete_object(Bucket=_S3_BUCKET, Key=key)


@skip_no_minio
def test_generate_presigned_url(s3_client, unique_key):
    """Generate a pre-signed download URL (used for recording playback)."""
    s3_client.put_object(Bucket=_S3_BUCKET, Key=unique_key, Body=b"presigned-test")

    url = s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": _S3_BUCKET, "Key": unique_key},
        ExpiresIn=300,
    )

    assert _S3_ENDPOINT.replace("http://", "") in url or "localhost" in url
    assert unique_key in url

    # Cleanup
    s3_client.delete_object(Bucket=_S3_BUCKET, Key=unique_key)


@skip_no_minio
def test_overwrite_recording(s3_client, unique_key):
    """Overwriting an object replaces its contents."""
    s3_client.put_object(Bucket=_S3_BUCKET, Key=unique_key, Body=b"version-1")
    s3_client.put_object(Bucket=_S3_BUCKET, Key=unique_key, Body=b"version-2")

    resp = s3_client.get_object(Bucket=_S3_BUCKET, Key=unique_key)
    assert resp["Body"].read() == b"version-2"

    # Cleanup
    s3_client.delete_object(Bucket=_S3_BUCKET, Key=unique_key)


@skip_no_minio
def test_head_object_returns_metadata(s3_client, unique_key):
    """HEAD request returns content length and type without downloading."""
    body = b"metadata-check"
    s3_client.put_object(
        Bucket=_S3_BUCKET,
        Key=unique_key,
        Body=body,
        ContentType="audio/mpeg",
    )

    head = s3_client.head_object(Bucket=_S3_BUCKET, Key=unique_key)
    assert head["ContentLength"] == len(body)
    assert head["ContentType"] == "audio/mpeg"

    # Cleanup
    s3_client.delete_object(Bucket=_S3_BUCKET, Key=unique_key)
