"""MinIO images come from quay.io, and the mc entrypoint sticks to what mc ships.

MinIO's `minio/minio` and `minio/mc` repositories stopped being pullable from Docker
Hub -- an anonymous pull now answers "pull access denied ... repository does not exist",
which is the same message a typo produces. Nothing in this repo had pinned a digest, so
the break arrived on its own: the Nightly workflow's `docker compose up -d` died in the
pull phase for eight consecutive nights, and because compose reports the *first* service
to error and interrupts the rest, the log named only `minio-init` while `minio` and the
`db-backup` build (`backup/Dockerfile` copies the mc binary out of the same image) were
equally broken and simply never got that far. `quay.io/minio/...` is MinIO's own
registry and carries both images.

The second test guards the repair's blast radius rather than the outage. The quay mc
image is a ubi-micro carrying bash and coreutils, and *not* grep, sed or awk. The old
`minio-init` entrypoint tested for an already-correct lifecycle rule with a `grep -Eq`,
which on this image does not fail the container -- it prints "grep: command not found",
the test reads false, and every `docker compose up` silently deletes the bucket's
lifecycle rule and writes a fresh one. A broken idempotence check that still exits 0 is
invisible, so pin the tools instead of the symptom.
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

# The Docker Hub namespace that went away. `quay.io/minio/...` is deliberately not a
# match: the pattern is anchored to a bare (registry-less) reference, which Docker
# resolves against Docker Hub.
RETIRED_MINIO_HUB_REF = re.compile(r"^minio/\S+")

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


def test_image_references_were_found() -> None:
    """Guard the parsers: an empty sweep would make the checks below vacuous."""
    refs = _image_references()
    assert any(r.startswith("docker-compose.yml::") for r in refs)
    assert any(r.startswith("backup/Dockerfile::") for r in refs)


@pytest.mark.parametrize("where", sorted(_image_references()))
def test_no_image_comes_from_the_retired_minio_docker_hub_namespace(where: str) -> None:
    image = _image_references()[where]
    assert not RETIRED_MINIO_HUB_REF.match(image), (
        f"{where} pulls {image!r} from Docker Hub, where MinIO no longer publishes; "
        f"anonymous pulls fail with 'repository does not exist'. Use quay.io/{image}."
    )


def test_every_minio_image_is_pulled_from_quay() -> None:
    """The positive half: catches a move to some third registry, not just a revert."""
    minio_refs = {where: image for where, image in _image_references().items() if "minio" in image}
    assert minio_refs, "no MinIO image references found -- has the stack changed?"
    for where, image in sorted(minio_refs.items()):
        assert image.startswith("quay.io/minio/"), f"{where} names {image!r}"


@pytest.mark.parametrize("tool", TOOLS_MISSING_FROM_MC_IMAGE)
def test_minio_init_entrypoint_avoids_tools_the_mc_image_lacks(tool: str) -> None:
    entrypoint = _services()["minio-init"]["entrypoint"]
    assert not re.search(rf"(?<![\w/-]){re.escape(tool)}\s", entrypoint), (
        f"minio-init's entrypoint calls {tool!r}, which the mc image does not ship. "
        f"It will print '{tool}: command not found', evaluate false, and leave the "
        f"lifecycle rule being rewritten on every `up` without failing the container."
    )
