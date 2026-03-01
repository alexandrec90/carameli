from fastapi import APIRouter

from app.api.vsapi import (
    area_codes,
    calls,
    customers,
    extensions,
    phone_lines,
    pointers,
    sci,
    sms,
    voicemail_drop,
)

vsapi_router = APIRouter(prefix="/vsapi/1.0.0")

vsapi_router.include_router(customers.router)
vsapi_router.include_router(phone_lines.router)
vsapi_router.include_router(extensions.router)
vsapi_router.include_router(sms.router)
vsapi_router.include_router(voicemail_drop.router)
vsapi_router.include_router(sci.router)
vsapi_router.include_router(pointers.router)
vsapi_router.include_router(area_codes.router)
vsapi_router.include_router(calls.router)
