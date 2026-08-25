"""add config tables (exemption_codes, expansion_modules, speed_dials)

Revision ID: 010
Revises: 009
Create Date: 2026-06-27 00:00:00.000000

CRUD config tables for the B5 Config vertical (legacy feature spec §11, §12, §28).
No call-engine wiring; these are pure config surfaces.

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "010"
down_revision: str | None = "009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _existing_tables(conn: sa.engine.Connection) -> set[str]:
    return {
        row[0]
        for row in conn.execute(
            sa.text(
                "SELECT table_name FROM information_schema.tables"
                " WHERE table_schema = current_schema()"
            )
        ).fetchall()
    }


def upgrade() -> None:
    conn = op.get_bind()
    existing = _existing_tables(conn)

    if "exemption_codes" not in existing:
        op.create_table(
            "exemption_codes",
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=True),
                server_default=sa.text("gen_random_uuid()"),
                nullable=False,
            ),
            sa.Column(
                "customer_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("customers.id"),
                nullable=False,
            ),
            sa.Column("description", sa.String(255), nullable=False),
            sa.Column("code", sa.String(64), nullable=False),
            sa.Column("call_restrictions", sa.String(255), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_exemption_codes_customer_id", "exemption_codes", ["customer_id"])

    if "expansion_modules" not in existing:
        op.create_table(
            "expansion_modules",
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=True),
                server_default=sa.text("gen_random_uuid()"),
                nullable=False,
            ),
            sa.Column(
                "customer_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("customers.id"),
                nullable=False,
            ),
            sa.Column("description", sa.String(255), nullable=False),
            sa.Column("brand", sa.String(128), nullable=False),
            sa.Column("model", sa.String(128), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_expansion_modules_customer_id", "expansion_modules", ["customer_id"])

    if "speed_dials" not in existing:
        op.create_table(
            "speed_dials",
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=True),
                server_default=sa.text("gen_random_uuid()"),
                nullable=False,
            ),
            sa.Column(
                "customer_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("customers.id"),
                nullable=False,
            ),
            sa.Column("code", sa.String(10), nullable=False),
            sa.Column("phone_number", sa.String(20), nullable=False),
            sa.Column("description", sa.String(255), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_speed_dials_customer_id", "speed_dials", ["customer_id"])


def downgrade() -> None:
    op.drop_index("ix_speed_dials_customer_id", table_name="speed_dials")
    op.drop_table("speed_dials")
    op.drop_index("ix_expansion_modules_customer_id", table_name="expansion_modules")
    op.drop_table("expansion_modules")
    op.drop_index("ix_exemption_codes_customer_id", table_name="exemption_codes")
    op.drop_table("exemption_codes")
