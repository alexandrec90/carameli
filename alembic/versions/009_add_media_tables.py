"""add media tables (audio_assets, voicemail_drop_events)

Revision ID: 009
Revises: 008
Create Date: 2026-06-27 00:00:00.000000

Audio asset library for Music, On-Hold, Advertising, Prompts, Greetings,
and Broadcast audio (cloudli spec §18-22, §25, §29). Voicemail drop event
history table so VsMessageDrop calls are persisted (spec §19).

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "009"
down_revision: str | None = "008"
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

    if "audio_assets" not in existing:
        op.create_table(
            "audio_assets",
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
            sa.Column("kind", sa.String(32), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("s3_key", sa.String(512), nullable=False),
            sa.Column("duration_seconds", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_audio_assets_customer_id", "audio_assets", ["customer_id"])
        op.create_index("ix_audio_assets_kind", "audio_assets", ["kind"])

    if "voicemail_drop_events" not in existing:
        op.create_table(
            "voicemail_drop_events",
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
            sa.Column("to_number", sa.String(32), nullable=False),
            sa.Column(
                "audio_asset_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("audio_assets.id"),
                nullable=True,
            ),
            sa.Column("call_sid", sa.String(255), nullable=True),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_voicemail_drop_events_customer_id", "voicemail_drop_events", ["customer_id"]
        )


def downgrade() -> None:
    op.drop_index("ix_voicemail_drop_events_customer_id", table_name="voicemail_drop_events")
    op.drop_table("voicemail_drop_events")
    op.drop_index("ix_audio_assets_kind", table_name="audio_assets")
    op.drop_index("ix_audio_assets_customer_id", table_name="audio_assets")
    op.drop_table("audio_assets")
