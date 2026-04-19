---
description: Multi-tenant auth and customer scoping — required on every route handler
paths:
  - app/api/**/*.py
---

# Rule: Auth & Customer Scoping

This is a **security** boundary, not a convention. Every endpoint operates in a multi-tenant
context where data must be strictly isolated per customer.

## Required on every route handler

- Depend on `get_auth_context` — provides the authenticated `AuthContext` (contains `vs_customer_id`)
- Filter every DB query by `vs_customer_id` via `enforce_customer_scope()`
- Never return data without scoping it to the authenticated customer

```python
@router.get("/List")
async def list_phone_lines(
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PhoneLinesResponse:
    """List phone lines for the authenticated customer."""
    lines = await line_repo.list_by_customer(session, auth.vs_customer_id)
    ...
```

## Exceptions (must be documented inline)

| Route type | Auth mechanism | Required comment |
| --- | --- | --- |
| Webhooks (Jambonz, Telnyx) | Signature validation — see `.claude/rules/webhooks.md` | `# auth: signature validation` |
| Public routes (e.g. `/health`) | None | `# public: no auth required — <reason>` |
