"""enable pg_stat_statements

Revision ID: 013
Revises: 012
Create Date: 2026-07-18 00:00:00.000000

Deployment ordering matters: first recreate the ``db`` container so PostgreSQL
starts with ``shared_preload_libraries=pg_stat_statements``, then run
``alembic upgrade head``. Creating the extension before the preload setting is
live does not make its statement statistics available until PostgreSQL restarts.

"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "013"
down_revision: str | None = "012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS pg_stat_statements")
