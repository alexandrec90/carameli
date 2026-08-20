"""Compose profiles must be self-contained.

`docker compose --profile X up` only *defines* the services carrying profile X (plus
unprofiled ones). A service reachable under X whose `depends_on` names a service that
X does not define makes the whole project invalid -- compose refuses with "depends on
undefined service", and it refuses at parse time, so it takes down every unrelated
service in that invocation too.

That is not hypothetical: `grafana` (profile `monitoring`) depends on `influxdb`,
which carried only `profiles: ["telephony"]`, so `--profile monitoring` could never
start. The workaround was to name the telephony profile as well purely to get a
definition for a service the monitoring stack genuinely wants -- which is a footgun,
because the obvious spelling (`--profile monitoring up`) is the broken one.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

COMPOSE_FILE = Path(__file__).resolve().parents[2] / "docker-compose.yml"


def _services() -> dict[str, dict]:
    data = yaml.safe_load(COMPOSE_FILE.read_text(encoding="utf-8"))
    return data.get("services") or {}


def _profiles(service: dict) -> set[str]:
    """The profiles gating a service. Empty means always defined."""
    return set(service.get("profiles") or [])


def _dependencies(service: dict) -> set[str]:
    """`depends_on` in either spelling: a list, or a mapping to conditions."""
    raw = service.get("depends_on") or []
    return set(raw) if isinstance(raw, (list, dict)) else set()


def _undefined_under(profile: str, services: dict[str, dict]) -> list[tuple[str, str]]:
    """(service, missing dependency) pairs when only `profile` is enabled."""
    defined = {
        name for name, spec in services.items() if not _profiles(spec) or profile in _profiles(spec)
    }
    return [
        (name, dep)
        for name in sorted(defined)
        for dep in sorted(_dependencies(services[name]))
        if dep not in defined
    ]


def test_compose_file_is_parseable() -> None:
    assert _services(), f"no services parsed from {COMPOSE_FILE}"


@pytest.mark.parametrize("profile", sorted({p for s in _services().values() for p in _profiles(s)}))
def test_each_profile_defines_every_service_it_depends_on(profile: str) -> None:
    """Enabling one profile must yield a valid project on its own.

    Parametrised per profile rather than asserting over all of them at once, so a
    failure names the profile that is broken instead of the first pair found.
    """
    missing = _undefined_under(profile, _services())
    assert not missing, "`--profile {}` is invalid; undefined dependencies: {}".format(
        profile,
        ", ".join(f"{svc} -> {dep}" for svc, dep in missing),
    )


def test_monitoring_stack_can_start_without_the_telephony_profile() -> None:
    """The specific regression: grafana's influxdb dependency.

    Kept alongside the general check because the general one would also pass if
    someone "fixed" this by deleting the depends_on, and grafana provisions a
    jambonz-influxdb datasource that needs the service to actually be there.
    """
    services = _services()
    assert "monitoring" in _profiles(services["influxdb"])
    assert "influxdb" in _dependencies(services["grafana"])
    assert not _undefined_under("monitoring", services)


def test_detects_a_dependency_the_profile_does_not_define() -> None:
    """The check itself fails when it should -- otherwise it asserts nothing."""
    broken = {
        "grafana": {"profiles": ["monitoring"], "depends_on": ["influxdb"]},
        "influxdb": {"profiles": ["telephony"]},
    }
    assert _undefined_under("monitoring", broken) == [("grafana", "influxdb")]
    assert _undefined_under("telephony", broken) == []


# --- Image pinning -------------------------------------------------------------
#
# A service with a `build:` key names an image we produce locally, so its
# reference is an output name rather than something pulled from a registry.
# Only pulled images can drift, so only those are checked here.

#: Services whose image must be pinned to a digest, not merely to a tag.
#:
#: These are the drachtio/jambonz call-path images. Two reasons a floating tag is
#: worse here than elsewhere: jambonz went dual-licensed on 2026-01-20, so a tag
#: that rolled onto 10.x would silently put the stack on a build that demands a
#: paid licence key; and the upstreams behind `rtpengine` and `api-server` have
#: published nothing since 2021 and 2023 respectively, so `latest` is a claim
#: about maintenance that is no longer true. A digest states what we actually run.
DIGEST_PINNED_SERVICES = frozenset({"freeswitch", "rtpengine", "jambonz", "jambonz-db-init"})


def _pulled_images() -> dict[str, str]:
    """Service name -> image reference, for services compose pulls rather than builds."""
    return {
        name: spec["image"]
        for name, spec in _services().items()
        if spec.get("image") and not spec.get("build")
    }


def test_every_pulled_image_names_a_tag_or_a_digest() -> None:
    """A bare repository name resolves to `latest`, which is whatever it is today."""
    bare = sorted(
        name
        for name, ref in _pulled_images().items()
        if "@" not in ref and ":" not in ref.rsplit("/", 1)[-1]
    )
    assert not bare, "unpinned image reference (no tag, no digest): " + ", ".join(bare)


@pytest.mark.parametrize("service", sorted(DIGEST_PINNED_SERVICES))
def test_call_path_images_are_digest_pinned(service: str) -> None:
    """Parametrised so a failure names the service rather than the first one found."""
    images = _pulled_images()
    assert service in images, f"{service} is not a pulled-image service any more"
    assert "@sha256:" in images[service], (
        f"{service} must pin a digest, not just a tag -- got {images[service]!r}. "
        "See DIGEST_PINNED_SERVICES for why this one in particular."
    )


def test_detects_an_image_that_names_no_tag() -> None:
    """The bare-reference check fails when it should."""
    refs = {
        "pinned": "ghcr.io/x/y@sha256:" + "0" * 64,
        "tagged": "postgres:18",
        "port_in_registry_host": "registry.local:5000/x/y:1.2",
        "bare": "ghcr.io/jambonz/api-server",
    }
    bare = [n for n, r in refs.items() if "@" not in r and ":" not in r.rsplit("/", 1)[-1]]
    assert bare == ["bare"]
