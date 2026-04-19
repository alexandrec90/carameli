"""add auto_attendant fields to phone_lines

Revision ID: 003
Revises: 002
Create Date: 2026-04-02 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "003"
down_revision: str | None = "002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    existing = {c["name"] for c in sa.inspect(conn).get_columns("phone_lines")}

    if "auto_attendant_enabled" not in existing:
        op.add_column(
            "phone_lines",
            sa.Column(
                "auto_attendant_enabled", sa.Boolean(), nullable=False, server_default="false"
            ),
        )
    if "auto_attendant_max_digits" not in existing:
        op.add_column(
            "phone_lines",
            sa.Column("auto_attendant_max_digits", sa.Integer(), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("phone_lines", "auto_attendant_max_digits")
    op.drop_column("phone_lines", "auto_attendant_enabled")
