"""Carameli's own resource-oriented REST API.

The `/vsapi/1.0.0/` tree mirrors the legacy vendor's RPC verbs (`VsExtension/Add`,
`VsMessaging/Sms/Enable/{customerId}/{number}`) because that is what CRM calls
today. This tree is what Carameli actually offers: resources, real HTTP status codes,
no success-in-body envelope.

`CarameliClient` on the CRM side is the adapter, and translating between the
legacy shape and this one is its whole job — so the translation belongs there, not
spread across both ends. The `/vsapi` routes stay published until CRM stops
calling them.
"""

from fastapi import APIRouter

from app.api.rest import extensions, phone_lines

rest_router = APIRouter(prefix="/api/v1")

rest_router.include_router(extensions.router)
rest_router.include_router(phone_lines.router)
