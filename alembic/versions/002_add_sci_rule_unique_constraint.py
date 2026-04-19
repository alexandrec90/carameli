"""add unique constraint for SCI rule routing keys

Revision ID: 002
Revises: 001
Create Date: 2026-02-22 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "002"
down_revision: str | None = "001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    existing = {c["name"] for c in sa.inspect(conn).get_unique_constraints("sci_rules")}
    if "uq_sci_rules_customer_extension_zip" not in existing:
        # Keep one row for any duplicated customer/extension/zip tuple before adding the constraint.
        op.execute(
            """
            DELETE FROM sci_rules a
            USING sci_rules b
            WHERE a.customer_id = b.customer_id
              AND a.extension_id = b.extension_id
              AND a.zip_code = b.zip_code
              AND a.ctid < b.ctid
            """
        )

        op.create_unique_constraint(
            "uq_sci_rules_customer_extension_zip",
            "sci_rules",
            ["customer_id", "extension_id", "zip_code"],
        )


def downgrade() -> None:
    op.drop_constraint(
        "uq_sci_rules_customer_extension_zip",
        "sci_rules",
        type_="unique",
    )
