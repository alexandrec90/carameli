from __future__ import annotations

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class BranchAssignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    vs_customer_id: int = Field(
        validation_alias=AliasChoices("vs_customer_id", "vsCustomerid", "vsCustomerId"),
        ge=1,
        le=2147483647,
    )
    branch_id: int | None = Field(
        default=None,
        validation_alias=AliasChoices("branch_id", "branchid", "branchId"),
        ge=1,
        le=2147483647,
    )
    target: str = Field(
        validation_alias=AliasChoices("target", "extension", "phoneNumberOrExtension"),
        min_length=1,
        max_length=20,
    )

    @field_validator("target", mode="before")
    @classmethod
    def strip_target(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class BranchAssignmentResponse(BaseModel):
    success: bool
    target: str
    target_type: str
    branch_id: int | None
