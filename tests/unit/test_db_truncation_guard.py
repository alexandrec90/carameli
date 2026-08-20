"""The session fixture must refuse a database nobody marked as disposable.

Regression for 2026-08-20, when a bare `pytest` inside an ephemeral worktree box
emptied the primary stack's `carameli` database: the box seeds its `.env` from the
source checkout, so `DATABASE_URL` named localhost:5432 while the box's own Postgres
sat unused on its leased port. The suite passed, so nothing reported the loss.

These test the guard, not the fixture -- `assert_disposable_database` is pure, which
is the whole reason it was split out of `test_engine`.
"""

from __future__ import annotations

import pytest

from tests.conftest import assert_disposable_database

DEV = "postgresql+asyncpg://carameli:pw@localhost:5432/carameli"  # pragma: allowlist secret
SCRATCH = (
    "postgresql+asyncpg://carameli:pw@localhost:5432/carameli_test"  # pragma: allowlist secret
)


def test_refuses_the_development_database():
    with pytest.raises(RuntimeError) as exc:
        assert_disposable_database(DEV, {})

    message = str(exc.value)
    # The name and the host are what tell an operator which stack was about to be
    # emptied -- a box and the primary differ only by port.
    assert "'carameli'" in message
    assert "localhost:5432" in message
    # And it must never print the credentials it parsed out of the URL.
    assert "pw" not in message.replace("carameli_test", "")


def test_allows_a_name_chosen_for_this():
    assert assert_disposable_database(SCRATCH, {}) is None
    assert assert_disposable_database("postgresql+asyncpg://u:p@db/test", {}) is None


def test_allows_ci_where_postgres_dies_with_the_job():
    # Every workflow points at a database called `carameli`, so without this the
    # guard would fail the PR gate rather than protect anything.
    assert assert_disposable_database(DEV, {"CI": "true"}) is None


def test_allows_an_explicit_opt_in():
    assert assert_disposable_database(DEV, {"CARAMELI_ALLOW_DB_TRUNCATE": "1"}) is None


def test_the_opt_in_is_exactly_one_value():
    # A stale `CARAMELI_ALLOW_DB_TRUNCATE=0` left in a shell must not read as consent.
    for value in ("0", "", "false", "no", "yes"):
        with pytest.raises(RuntimeError):
            assert_disposable_database(DEV, {"CARAMELI_ALLOW_DB_TRUNCATE": value})


def test_a_url_with_no_database_name_is_refused():
    with pytest.raises(RuntimeError) as exc:
        assert_disposable_database("postgresql+asyncpg://u:p@localhost:5432", {})

    assert "(unnamed)" in str(exc.value)
