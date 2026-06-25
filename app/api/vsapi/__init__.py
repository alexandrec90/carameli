from fastapi import APIRouter

from app.api.vsapi import (
    agent_status,
    area_codes,
    callback,
    calls,
    conferences,
    customers,
    extensions,
    group_extensions,
    intercom_groups,
    multicast_groups,
    parking_lots,
    phone_lines,
    pointers,
    recordings,
    sci,
    sms,
    voicemail_drop,
    webhooks,
)

vsapi_router = APIRouter(prefix="/vsapi/1.0.0")

vsapi_router.include_router(agent_status.router)
vsapi_router.include_router(customers.router)
vsapi_router.include_router(phone_lines.router)
vsapi_router.include_router(extensions.router)
vsapi_router.include_router(sms.router)
vsapi_router.include_router(voicemail_drop.router)
vsapi_router.include_router(sci.router)
vsapi_router.include_router(pointers.router)
vsapi_router.include_router(area_codes.router)
vsapi_router.include_router(calls.router)
vsapi_router.include_router(callback.router)
vsapi_router.include_router(recordings.router)
vsapi_router.include_router(webhooks.router)
vsapi_router.include_router(group_extensions.router)
vsapi_router.include_router(intercom_groups.router)
vsapi_router.include_router(multicast_groups.router)
vsapi_router.include_router(conferences.router)
vsapi_router.include_router(parking_lots.router)
