from __future__ import annotations

from typing import Any, cast

import pytest
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text

pytestmark = pytest.mark.asyncio(loop_scope="session")

_EXPECTED_INDEXES = {
    "call_events": {
        "ix_call_events_customer_id",
        "ix_call_events_started_at",
        "ix_call_events_unposted_created_at",
    },
    "sms_messages": {
        "ix_sms_messages_created_at",
        "ix_sms_messages_customer_id",
        "ix_sms_messages_phone_line_id",
        "ix_sms_messages_unposted_created_at",
    },
}

_PARTIAL_INDEXES = {
    "call_events": "ix_call_events_unposted_created_at",
    "sms_messages": "ix_sms_messages_unposted_created_at",
}


@pytest.mark.parametrize("table_name", _EXPECTED_INDEXES)
async def test_growth_table_indexes_exist(db_session, table_name: str) -> None:
    connection = await db_session.connection()

    def _get_indexes(sync_connection) -> list[dict[str, Any]]:
        return cast(list[dict[str, Any]], sa_inspect(sync_connection).get_indexes(table_name))

    indexes = await connection.run_sync(_get_indexes)
    indexes_by_name = {index["name"]: index for index in indexes}

    assert _EXPECTED_INDEXES[table_name] <= indexes_by_name.keys()

    partial = indexes_by_name[_PARTIAL_INDEXES[table_name]]
    predicate = str(partial["dialect_options"]["postgresql_where"])
    assert predicate.replace("(", "").replace(")", "").strip().lower() == "posted = false"


async def test_pg_stat_statements_extension_exists(db_session) -> None:
    result = await db_session.execute(
        text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements')")
    )

    assert result.scalar_one() is True
