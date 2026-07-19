"""add growth-table indexes

Revision ID: 012
Revises: 011
Create Date: 2026-07-18 00:00:00.000000

Plain index creation is appropriate at the current table sizes. A production
deployment against large tables should instead create these indexes concurrently
inside an Alembic autocommit block, using the direct (non-PgBouncer) database URL.

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "012"
down_revision: str | None = "011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_call_events_customer_id",
        "call_events",
        ["customer_id"],
        unique=False,
    )
    op.create_index(
        "ix_call_events_started_at",
        "call_events",
        ["started_at"],
        unique=False,
    )
    op.create_index(
        "ix_call_events_unposted_created_at",
        "call_events",
        ["created_at"],
        unique=False,
        postgresql_where=sa.text("posted = false"),
    )
    op.create_index(
        "ix_sms_messages_created_at",
        "sms_messages",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_sms_messages_customer_id",
        "sms_messages",
        ["customer_id"],
        unique=False,
    )
    op.create_index(
        "ix_sms_messages_phone_line_id",
        "sms_messages",
        ["phone_line_id"],
        unique=False,
    )
    op.create_index(
        "ix_sms_messages_unposted_created_at",
        "sms_messages",
        ["created_at"],
        unique=False,
        postgresql_where=sa.text("posted = false"),
    )


def downgrade() -> None:
    op.drop_index("ix_sms_messages_unposted_created_at", table_name="sms_messages")
    op.drop_index("ix_sms_messages_phone_line_id", table_name="sms_messages")
    op.drop_index("ix_sms_messages_customer_id", table_name="sms_messages")
    op.drop_index("ix_sms_messages_created_at", table_name="sms_messages")
    op.drop_index("ix_call_events_unposted_created_at", table_name="call_events")
    op.drop_index("ix_call_events_started_at", table_name="call_events")
    op.drop_index("ix_call_events_customer_id", table_name="call_events")
