"""add posted flag to sms_messages for VanillaSoft forward tracking

Revision ID: 011
Revises: 010
Create Date: 2026-07-04 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "011"
down_revision: str | None = "010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("sms_messages")}
    if "posted" in columns:
        return
    # server_default backfills existing rows, so the column can be NOT NULL in one step.
    op.add_column(
        "sms_messages",
        sa.Column("posted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("sms_messages", "posted")
