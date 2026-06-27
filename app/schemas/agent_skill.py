from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class AddAgentSkillRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    agent_id: uuid.UUID
    skill: str = Field(min_length=1, max_length=64)
    level: int = Field(default=1, ge=1, le=100)


class AgentSkillResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    agent_id: uuid.UUID
    skill: str
    level: int
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class AgentSkillListResponse(BaseModel):
    agent_skills: list[AgentSkillResponse]
    vs_customer_id: int
