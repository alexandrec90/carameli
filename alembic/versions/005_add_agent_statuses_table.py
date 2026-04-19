"""add agent_statuses table

Revision ID: 005
Revises: 004
Create Date: 2026-04-02 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "005"
down_revision: str | None = "004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())
    if "agent_statuses" not in existing:
        op.create_table(
            "agent_statuses",
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=True),
                server_default=sa.text("gen_random_uuid()"),
                nullable=False,
            ),
            sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("extension_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("sip_username", sa.String(64), nullable=False),
            sa.Column("call_state", sa.String(32), nullable=True),
            sa.Column("call_sid", sa.String(64), nullable=True),
            sa.Column("sip_registered", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column(
                "polled_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("sip_username"),
            sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["extension_id"], ["extensions.id"], ondelete="SET NULL"),
        )
    indexes = (
        {idx["name"] for idx in inspector.get_indexes("agent_statuses")}
        if "agent_statuses" in existing
        else set()
    )
    if "ix_agent_statuses_customer_id" not in indexes:
        op.create_index("ix_agent_statuses_customer_id", "agent_statuses", ["customer_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_statuses_customer_id", table_name="agent_statuses")
    op.drop_table("agent_statuses")
