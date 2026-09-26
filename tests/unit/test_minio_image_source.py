"""MinIO images come from pgsty's pinned rebuild, and the mc entrypoint sticks to what mc ships.

MinIO has withdrawn anonymous pulls twice. First Docker Hub: `minio/minio` and
`minio/mc` began answering "pull access denied ... repository does not exist", the
message a typo produces, and the Nightly workflow's `docker compose up -d` died in the
pull phase for eight nights (issue #354). The repair moved to `quay.io/minio/...`, and
on 2026-09-25 quay did the same -- the anonymous token for both repositories now grants
no actions, so every pull is `401 UNAUTHORIZED` (issue #390). The same commit had passed
the night before: nothing in this repo changed, the registry did.

The images now come from `pgsty/minio` and `pgsty/mc` on Docker Hub, the community
fork that still builds MinIO on the same ubi-micro base -- same entrypoint, `curl` for
the health check, `mc` at `/usr/bin/mc` for `backup/Dockerfile`'s copy. Because it is a
third party's rebuild rather than MinIO's own, each reference is pinned to a release
tag *and* a digest, so a pull either gets the bytes that were verified or fails loudly.
Compose reports only the *first* service to error, so all three references -- `minio`,
`minio-init` and the `db-backup` build -- are swept, not just the one a log names.

The last test guards the entrypoint rather than the source. The mc image carries bash
and coreutils and *not* grep, sed or awk. A `grep -Eq` in `minio-init` does not fail the
container -- it prints "grep: command not found", the test reads false, and every
`docker compose up` silently deletes the bucket's lifecycle rule and writes a fresh one.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
COMPOSE_FILE = REPO / "docker-compose.yml"
BACKUP_DOCKERFILE = REPO / "backup" / "Dockerfile"

# `FROM <ref>` with the optional `AS <stage>` and any `--platform=` flags dropped.
FROM_LINE = re.compile(r"^FROM\s+(?:--\S+\s+)*(\S+)", re.MULTILINE)

# Registries MinIO itself publishes to, both of which now refuse anonymous pulls. The
# bare form is anchored: Docker resolves a registry-less `minio/...` against Docker Hub.
RETIRED_MINIO_SOURCES = (
    re.compile(r"^(?:docker\.io/)?minio/\S+"),
    re.compile(r"^quay\.io/minio/\S+"),
)

# The pinned shape every MinIO reference must take: a release tag and a digest.
PINNED_PGSTY_REF = re.compile(r"^pgsty/(?:minio|mc):RELEASE\.[0-9T-]+Z@sha256:[0-9a-f]{64}$")

# Absent from the mc image. Each would be a silent no-op inside a `&&` pipeline rather
# than a visible failure, so a reviewer cannot rely on CI going red.
TOOLS_MISSING_FROM_MC_IMAGE = ("grep", "sed", "awk")


def _services() -> dict[str, dict]:
    data = yaml.safe_load(COMPOSE_FILE.read_text(encoding="utf-8"))
    return data.get("services") or {}


def _compose_images() -> dict[str, str]:
    """`{service: image}` for every service in the compose file that names one."""
    return {name: spec["image"] for name, spec in _services().items() if spec.get("image")}


def _image_references() -> dict[str, str]:
    """Every image this repo pulls or builds from, keyed by where it is written."""
    refs = {f"docker-compose.yml::{svc}": img for svc, img in _compose_images().items()}
    for ref in FROM_LINE.findall(BACKUP_DOCKERFILE.read_text(encoding="utf-8")):
        refs[f"backup/Dockerfile::FROM {ref}"] = ref
    return refs


def _minio_references() -> dict[str, str]:
    return {
        where: image
        for where, image in _image_references().items()
        if re.search(r"(?:^|/)(?:minio|mc)[:@]", image)
    }


def test_image_references_were_found() -> None:
    """Guard the parsers: an empty sweep would make the checks below vacuous."""
    refs = _image_references()
    assert any(r.startswith("docker-compose.yml::") for r in refs)
    assert any(r.startswith("backup/Dockerfile::") for r in refs)


def test_every_minio_reference_is_swept() -> None:
    """minio, minio-init and the db-backup build stage all pull a MinIO image."""
    where = set(_minio_references())
    assert "docker-compose.yml::minio" in where
    assert "docker-compose.yml::minio-init" in where
    assert any(w.startswith("backup/Dockerfile::") for w in where)


@pytest.mark.parametrize("where", sorted(_image_references()))
def test_no_image_comes_from_a_registry_minio_withdrew(where: str) -> None:
    image = _image_references()[where]
    for retired in RETIRED_MINIO_SOURCES:
        assert not retired.match(image), (
            f"{where} pulls {image!r}, from a registry where MinIO no longer allows "
            f"anonymous pulls. Use the pinned pgsty/minio or pgsty/mc rebuild."
        )


def test_every_minio_image_is_a_pinned_pgsty_rebuild() -> None:
    """The positive half: catches a move to some other registry, or an unpinned tag."""
    for where, image in sorted(_minio_references().items()):
        assert PINNED_PGSTY_REF.match(image), (
            f"{where} names {image!r}; expected pgsty/<minio|mc>:RELEASE.<ts>@sha256:<digest>"
        )


@pytest.mark.parametrize("tool", TOOLS_MISSING_FROM_MC_IMAGE)
def test_minio_init_entrypoint_avoids_tools_the_mc_image_lacks(tool: str) -> None:
    entrypoint = _services()["minio-init"]["entrypoint"]
    assert not re.search(rf"(?<![\w/-]){re.escape(tool)}\s", entrypoint), (
        f"minio-init's entrypoint calls {tool!r}, which the mc image does not ship. "
        f"It will print '{tool}: command not found', evaluate false, and leave the "
        f"lifecycle rule being rewritten on every `up` without failing the container."
    )
