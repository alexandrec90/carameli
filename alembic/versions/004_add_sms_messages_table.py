"""add sms_messages table

Revision ID: 004
Revises: 003
Create Date: 2026-04-02 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "004"
down_revision: str | None = "003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "sms_messages" in inspector.get_table_names():
        return
    op.create_table(
        "sms_messages",
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
            nullable=True,
        ),
        sa.Column(
            "phone_line_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("phone_lines.id"),
            nullable=True,
        ),
        sa.Column("message_sid", sa.String(64), nullable=True),
        sa.Column("direction", sa.String(8), nullable=False),
        sa.Column("from_number", sa.String(20), nullable=False),
        sa.Column("to_number", sa.String(20), nullable=False),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("delivery_status", sa.String(32), nullable=True),
        sa.Column("error_code", sa.String(16), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_sid", name="uq_sms_messages_message_sid"),
    )


def downgrade() -> None:
    op.drop_table("sms_messages")
