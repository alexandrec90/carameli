from __future__ import annotations

import ast
import os
import pathlib
import subprocess
import uuid

import pytest
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, text

from app.models.did_pointer import DidPointer
from app.models.sci_rule import SciRule
from app.repositories.extension_repo import ExtensionRepo
from app.repositories.phone_line_repo import PhoneLineRepo
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_PROJECT_ROOT = pathlib.Path(__file__).parents[2]
_VERSIONS_DIR = _PROJECT_ROOT / "alembic" / "versions"
_MIGRATION_SCHEMA = "migration_test_alembic"


def _build_alembic_env(schema: str) -> dict[str, str]:
    from app.core.config import settings

    env = os.environ.copy()
    env["DATABASE_URL"] = settings.database_url
    env["_ALEMBIC_SCHEMA"] = schema
    return env


_CUST_BASE = "/vsapi/1.0.0/VsCustomer"


async def _create_customer(client, vs_id: int, include_api_key: bool = True) -> dict:
    payload: dict[str, str | int] = {
        "vs_customer_id": vs_id,
    }
    if include_api_key:
        payload["api_key"] = f"key-{vs_id}"

    resp = await client.post(f"{_CUST_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201
    return resp.json()


async def test_create_customer_without_api_key_generates_one(client) -> None:
    body = await _create_customer(client, 8101, include_api_key=False)

    assert body["vs_customer_id"] == 8101
    assert isinstance(body["plaintext_key"], str)
    assert len(body["plaintext_key"]) >= 20


async def test_voicemail_drop_rejects_invalid_payload(client) -> None:
    resp = await client.post(
        "/vsapi/1.0.0/VsMessageDrop",
        json={
            "vs_customer_id": 8102,
            "extension": "+14155550000",
            "msg_drop_number": "123",
            "audio_url": "",
        },
        headers=AUTH_HEADERS,
    )

    assert resp.status_code == 422


async def test_add_pointer_rejects_area_code_style_input(client) -> None:
    resp = await client.post(
        "/vsapi/1.0.0/AddPointerToExtension",
        json={
            "vs_customer_id": 8103,
            "phone_number": "415",
            "extension_number": "101",
        },
        headers=AUTH_HEADERS,
    )

    assert resp.status_code == 422


async def test_post_sci_by_zip_code_is_upsert_not_duplicate(client, db_session) -> None:
    customer = await _create_customer(client, 8104)
    customer_id = uuid.UUID(customer["id"])

    ext_repo = ExtensionRepo(db_session)
    ext = await ext_repo.create(
        customer_id=customer_id,
        extension_number="201",
        sip_username="ext201_test8104",
        sip_credential_sid="CRtest8104",
        sip_domain_sid="SDtest8104",
    )

    url = "/vsapi/1.0.0/PostSCIbyZipCode"
    first = await client.post(
        url,
        json={
            "vs_customer_id": 8104,
            "extension_number": "201",
            "zip_code": "94105",
            "enabled": True,
        },
        headers=AUTH_HEADERS,
    )
    assert first.status_code == 200

    second = await client.post(
        url,
        json={
            "vs_customer_id": 8104,
            "extension_number": "201",
            "zip_code": "94105",
            "enabled": False,
        },
        headers=AUTH_HEADERS,
    )
    assert second.status_code == 200

    result = await db_session.execute(
        select(SciRule).where(
            SciRule.customer_id == customer_id,
            SciRule.extension_id == ext.id,
            SciRule.zip_code == "94105",
        )
    )
    rows = result.scalars().all()

    assert len(rows) == 1
    assert rows[0].enabled is False


async def test_add_pointer_same_mapping_is_idempotent(client, db_session) -> None:
    customer = await _create_customer(client, 8105)
    customer_id = uuid.UUID(customer["id"])

    line_repo = PhoneLineRepo(db_session)
    phone_line = await line_repo.create(
        customer_id=customer_id,
        phone_number="+14155558105",
        provider_sid="PNtest8105",
    )

    ext_repo = ExtensionRepo(db_session)
    await ext_repo.create(
        customer_id=customer_id,
        extension_number="301",
        sip_username="ext301_test8105",
        sip_credential_sid="CRtest8105",
        sip_domain_sid="SDtest8105",
    )

    payload = {
        "vs_customer_id": 8105,
        "phone_number": "+14155558105",
        "extension_number": "301",
    }

    first = await client.post(
        "/vsapi/1.0.0/AddPointerToExtension",
        json=payload,
        headers=AUTH_HEADERS,
    )
    assert first.status_code == 200

    second = await client.post(
        "/vsapi/1.0.0/AddPointerToExtension",
        json=payload,
        headers=AUTH_HEADERS,
    )
    assert second.status_code == 200

    result = await db_session.execute(
        select(DidPointer).where(
            DidPointer.phone_line_id == phone_line.id,
        )
    )
    rows = result.scalars().all()

    assert len(rows) == 1


# ─────────────────────────────────────────────────────────────────────────────
# A4 — Alembic migration safety tests (marked slow, excluded from default run)
# Run explicitly: pytest --override-ini="addopts=--ignore=tests/e2e" -m slow
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.slow
def test_downgrade_path_all_migrations_have_non_empty_downgrade() -> None:
    """Every migration file must have a downgrade() with actual operations (not just pass)."""
    for migration_file in sorted(_VERSIONS_DIR.glob("[0-9]*.py")):
        source = migration_file.read_text()
        tree = ast.parse(source)
        found = False
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == "downgrade":
                found = True
                body = node.body
                # Allow docstrings followed by statements, but reject lone pass / ...
                real_stmts = [
                    s
                    for s in body
                    if not (
                        isinstance(s, ast.Expr)
                        and isinstance(s.value, ast.Constant)
                        and isinstance(s.value.value, str)
                    )
                ]
                is_empty = len(real_stmts) == 1 and isinstance(real_stmts[0], ast.Pass)
                assert not is_empty, (
                    f"{migration_file.name}: downgrade() has no operations (just pass)"
                )
                break
        assert found, f"{migration_file.name}: no downgrade() function found"


@pytest.mark.slow
async def test_schema_drift_no_model_columns_missing_from_db(test_engine) -> None:
    """Every ORM model column must be present in the live test database."""
    import app.models  # noqa: F401  — ensure all models are registered
    from app.core.database import Base

    async with test_engine.connect() as conn:

        def _collect_db_schema(sync_conn):
            insp = sa_inspect(sync_conn)
            return {
                tbl: {col["name"] for col in insp.get_columns(tbl)}
                for tbl in insp.get_table_names(schema="public")
            }

        db_tables = await conn.run_sync(_collect_db_schema)

    missing: list[str] = []
    for table_name, table in Base.metadata.tables.items():
        if table_name not in db_tables:
            missing.append(f"Table '{table_name}' not in DB")
            continue
        db_cols = db_tables[table_name]
        for col in table.columns:
            if col.name not in db_cols:
                missing.append(f"  {table_name}.{col.name} missing from DB")

    assert not missing, "Schema drift detected:\n" + "\n".join(missing)


@pytest.mark.slow
async def test_upgrade_on_clean_schema(test_engine) -> None:
    """alembic upgrade head must succeed on an empty migration_test schema."""
    async with test_engine.begin() as conn:
        await conn.execute(text(f"DROP SCHEMA IF EXISTS {_MIGRATION_SCHEMA} CASCADE"))
        await conn.execute(text(f"CREATE SCHEMA {_MIGRATION_SCHEMA}"))

    env = _build_alembic_env(_MIGRATION_SCHEMA)

    try:
        result = subprocess.run(  # noqa: ASYNC221
            ["alembic", "upgrade", "head"],  # noqa: S607
            cwd=str(_PROJECT_ROOT),
            env=env,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, (
            f"alembic upgrade head failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
        )
    finally:
        async with test_engine.begin() as conn:
            await conn.execute(text(f"DROP SCHEMA IF EXISTS {_MIGRATION_SCHEMA} CASCADE"))


@pytest.mark.slow
async def test_migration_round_trip(test_engine) -> None:
    """upgrade head → downgrade base → upgrade head must all succeed without errors."""
    async with test_engine.begin() as conn:
        await conn.execute(text(f"DROP SCHEMA IF EXISTS {_MIGRATION_SCHEMA} CASCADE"))
        await conn.execute(text(f"CREATE SCHEMA {_MIGRATION_SCHEMA}"))

    env = _build_alembic_env(_MIGRATION_SCHEMA)

    try:
        for command in [
            ["alembic", "upgrade", "head"],
            ["alembic", "downgrade", "base"],
            ["alembic", "upgrade", "head"],
        ]:
            result = subprocess.run(  # noqa: ASYNC221, S603
                command,
                cwd=str(_PROJECT_ROOT),
                env=env,
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0, (
                f"{' '.join(command)} failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
            )
    finally:
        async with test_engine.begin() as conn:
            await conn.execute(text(f"DROP SCHEMA IF EXISTS {_MIGRATION_SCHEMA} CASCADE"))
