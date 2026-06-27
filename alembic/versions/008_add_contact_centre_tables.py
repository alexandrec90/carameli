"""add contact centre tables (agents, call_queues, agent_skills)

Revision ID: 008
Revises: 007
Create Date: 2026-06-27 00:00:00.000000

Config-only CRUD tables for the Contact Centre vertical (cloudli spec §35–37).
Call-routing integration deferred; these are pure config surfaces.

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "008"
down_revision: str | None = "007"
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

    if "agents" not in existing:
        op.create_table(
            "agents",
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
            sa.Column(
                "extension_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("extensions.id"),
                nullable=True,
            ),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("status", sa.String(64), nullable=False, server_default="available"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_agents_customer_id", "agents", ["customer_id"])
        # Partial unique index: only one active agent may claim a given extension.
        op.execute(
            sa.text(
                "CREATE UNIQUE INDEX uq_agents_extension_id_active"
                " ON agents (extension_id)"
                " WHERE active = true AND extension_id IS NOT NULL"
            )
        )

    if "call_queues" not in existing:
        op.create_table(
            "call_queues",
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
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("strategy", sa.String(64), nullable=False, server_default="round-robin"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_call_queues_customer_id", "call_queues", ["customer_id"])

    if "agent_skills" not in existing:
        op.create_table(
            "agent_skills",
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
            sa.Column(
                "agent_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("agents.id"),
                nullable=False,
            ),
            sa.Column("skill", sa.String(64), nullable=False),
            sa.Column("level", sa.Integer(), nullable=False, server_default=sa.text("1")),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_agent_skills_customer_id", "agent_skills", ["customer_id"])
        op.create_index("ix_agent_skills_agent_id", "agent_skills", ["agent_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_skills_agent_id", table_name="agent_skills")
    op.drop_index("ix_agent_skills_customer_id", table_name="agent_skills")
    op.drop_table("agent_skills")
    op.drop_index("ix_call_queues_customer_id", table_name="call_queues")
    op.drop_table("call_queues")
    op.drop_index("uq_agents_extension_id_active", table_name="agents")
    op.drop_index("ix_agents_customer_id", table_name="agents")
    op.drop_table("agents")
