"""add VanillaLand VoIP compatibility workflows

Revision ID: 014
Revises: 013
Create Date: 2026-08-16 00:00:00.000000

Adds branch metadata, provisioned SIP-client secret delivery, per-call SCI
preparations, voicemail-drop codes, and recording archive job state.

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "014"
down_revision: str | None = "013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("extensions", sa.Column("first_name", sa.String(100), nullable=True))
    op.add_column("extensions", sa.Column("last_name", sa.String(100), nullable=True))
    op.add_column("extensions", sa.Column("branch_id", sa.Integer(), nullable=True))
    op.add_column("extensions", sa.Column("sip_password_encrypted", sa.Text(), nullable=True))
    op.add_column("extensions", sa.Column("sip_secret_delivered_at", sa.DateTime(), nullable=True))
    op.add_column("phone_lines", sa.Column("branch_id", sa.Integer(), nullable=True))
    op.add_column("audio_assets", sa.Column("voicemail_drop_code", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_audio_assets_voicemail_drop_code_range",
        "audio_assets",
        "voicemail_drop_code IS NULL OR voicemail_drop_code BETWEEN 1 AND 9",
    )
    op.create_unique_constraint(
        "uq_audio_assets_customer_voicemail_drop_code",
        "audio_assets",
        ["customer_id", "voicemail_drop_code"],
    )

    op.create_table(
        "sci_preparations",
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
            nullable=False,
        ),
        sa.Column("contact_id", sa.Integer(), nullable=False),
        sa.Column("destination_number", sa.String(20), nullable=False),
        sa.Column("candidate_area_codes", postgresql.JSONB(), nullable=False),
        sa.Column(
            "selected_phone_line_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("phone_lines.id"),
            nullable=False,
        ),
        sa.Column("selected_caller_id", sa.String(20), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "customer_id",
            "contact_id",
            name="uq_sci_preparations_customer_contact",
        ),
    )
    op.create_index("ix_sci_preparations_customer_id", "sci_preparations", ["customer_id"])
    op.create_index("ix_sci_preparations_expires_at", "sci_preparations", ["expires_at"])

    op.create_table(
        "recording_archives",
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
        sa.Column("export_id", sa.Integer(), nullable=False),
        sa.Column("archive_name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("file_count", sa.Integer(), nullable=False),
        sa.Column("s3_key", sa.String(512), nullable=True),
        sa.Column("error", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "customer_id", "export_id", name="uq_recording_archives_customer_export"
        ),
    )
    op.create_index("ix_recording_archives_customer_id", "recording_archives", ["customer_id"])

    op.create_table(
        "recording_archive_items",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "archive_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("recording_archives.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "call_event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("call_events.id"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("unique_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_recording_archive_items_archive_id", "recording_archive_items", ["archive_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_recording_archive_items_archive_id", table_name="recording_archive_items")
    op.drop_table("recording_archive_items")
    op.drop_index("ix_recording_archives_customer_id", table_name="recording_archives")
    op.drop_table("recording_archives")
    op.drop_index("ix_sci_preparations_expires_at", table_name="sci_preparations")
    op.drop_index("ix_sci_preparations_customer_id", table_name="sci_preparations")
    op.drop_table("sci_preparations")
    op.drop_constraint(
        "uq_audio_assets_customer_voicemail_drop_code", "audio_assets", type_="unique"
    )
    op.drop_constraint("ck_audio_assets_voicemail_drop_code_range", "audio_assets", type_="check")
    op.drop_column("audio_assets", "voicemail_drop_code")
    op.drop_column("phone_lines", "branch_id")
    op.drop_column("extensions", "sip_secret_delivered_at")
    op.drop_column("extensions", "sip_password_encrypted")
    op.drop_column("extensions", "branch_id")
    op.drop_column("extensions", "last_name")
    op.drop_column("extensions", "first_name")
