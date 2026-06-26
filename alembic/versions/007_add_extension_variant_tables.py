"""add extension variant tables

Revision ID: 007
Revises: 006
Create Date: 2026-06-25 00:00:00.000000

Sibling config tables per extension variant (cloudli spec §10, §14-16, §24):
group_extensions, intercom_groups, multicast_groups, conferences, parking_lots.
The core ``extensions`` table is intentionally left untouched (no polymorphic kind).

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "007"
down_revision: str | None = "006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _id_column() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def _customer_id_column() -> sa.Column:
    return sa.Column(
        "customer_id",
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("customers.id"),
        nullable=False,
    )


def _timestamp_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    ]


def _string_array(length: int) -> postgresql.ARRAY:
    return postgresql.ARRAY(sa.String(length))


_TABLES = (
    "group_extensions",
    "intercom_groups",
    "multicast_groups",
    "conferences",
    "parking_lots",
)


def upgrade() -> None:
    conn = op.get_bind()
    existing = {
        row[0]
        for row in conn.execute(
            sa.text(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()"
            )
        ).fetchall()
    }

    if "group_extensions" not in existing:
        op.create_table(
            "group_extensions",
            _id_column(),
            _customer_id_column(),
            sa.Column("description", sa.String(255), nullable=False, server_default=""),
            sa.Column("number", sa.String(20), nullable=False),
            sa.Column(
                "subscribed_extensions",
                _string_array(20),
                nullable=False,
                server_default=sa.text("'{}'::varchar[]"),
            ),
            *_timestamp_columns(),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_group_extensions_customer_id", "group_extensions", ["customer_id"])

    if "intercom_groups" not in existing:
        op.create_table(
            "intercom_groups",
            _id_column(),
            _customer_id_column(),
            sa.Column("number", sa.String(20), nullable=False),
            sa.Column("description", sa.String(255), nullable=False, server_default=""),
            sa.Column(
                "subscriber_extensions",
                _string_array(20),
                nullable=False,
                server_default=sa.text("'{}'::varchar[]"),
            ),
            sa.Column(
                "bidirectional_audio",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column("expiry", sa.String(64), nullable=True),
            *_timestamp_columns(),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_intercom_groups_customer_id", "intercom_groups", ["customer_id"])

    if "multicast_groups" not in existing:
        op.create_table(
            "multicast_groups",
            _id_column(),
            _customer_id_column(),
            sa.Column("extension", sa.String(20), nullable=False),
            sa.Column("description", sa.String(255), nullable=False, server_default=""),
            sa.Column(
                "extensions",
                _string_array(20),
                nullable=False,
                server_default=sa.text("'{}'::varchar[]"),
            ),
            sa.Column(
                "users",
                _string_array(64),
                nullable=False,
                server_default=sa.text("'{}'::varchar[]"),
            ),
            *_timestamp_columns(),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_multicast_groups_customer_id", "multicast_groups", ["customer_id"])

    if "conferences" not in existing:
        op.create_table(
            "conferences",
            _id_column(),
            _customer_id_column(),
            sa.Column("number", sa.String(20), nullable=False),
            sa.Column("description", sa.String(255), nullable=False, server_default=""),
            sa.Column(
                "max_participants", sa.Integer(), nullable=False, server_default=sa.text("10")
            ),
            sa.Column(
                "recorded_calls", sa.Boolean(), nullable=False, server_default=sa.text("false")
            ),
            *_timestamp_columns(),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_conferences_customer_id", "conferences", ["customer_id"])

    if "parking_lots" not in existing:
        op.create_table(
            "parking_lots",
            _id_column(),
            _customer_id_column(),
            sa.Column("description", sa.String(255), nullable=False, server_default=""),
            sa.Column("extension", sa.String(20), nullable=False),
            sa.Column(
                "ring_back_time_limit",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("30"),
            ),
            *_timestamp_columns(),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_parking_lots_customer_id", "parking_lots", ["customer_id"])


def downgrade() -> None:
    for table in _TABLES:
        op.drop_index(f"ix_{table}_customer_id", table_name=table)
        op.drop_table(table)
