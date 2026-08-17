from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class AccountExtensionCredential(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    full_name: str = Field(serialization_alias="fullName")
    first_name: str = Field(serialization_alias="firstName")
    last_name: str = Field(serialization_alias="lastName")
    extension: str
    sip_username: str = Field(serialization_alias="sipUsername")
    sip_password: str = Field(serialization_alias="sipPassword")
    sip_domain: str = Field(serialization_alias="sipDomain")


class AccountDataResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    vs_customer_id: int = Field(serialization_alias="vsCustomerId")
    extensions: list[AccountExtensionCredential] = Field(serialization_alias="Extensions")
