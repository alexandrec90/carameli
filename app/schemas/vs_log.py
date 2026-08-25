from __future__ import annotations

from pydantic import BaseModel


class VsLogEntry(BaseModel):
    """One log record shipped from CRM staging by NLog's WebService target.

    NLog posts a single JSON object per request. Field names mirror the
    ``<parameter>`` layouts in the staging ``NLog.config`` snippet
    (``docs/plans/active/airtight-crm/nlog-snippet.md``). ``auth`` is a
    fallback credential carried in the body for NLog builds too old to attach a
    ``<header>`` (see the version caveat in that doc); it is never logged.
    """

    time: str
    level: str
    logger: str
    message: str
    exception: str | None = None
    machine: str | None = None
    auth: str | None = None
