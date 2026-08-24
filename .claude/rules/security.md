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

## Routes that return a secret in the body

A handful of routes hand a live credential back to the caller — the one-time
`AccessCheck/AccountData` delivery, and `POST /extensions/{id}/webphone-credential`,
which issues the SIP password a browser softphone registers with. Customer scoping is
necessary for these and not sufficient: the response itself is the sensitive artefact.

- **Mint with POST, never GET.** These routes create or rotate a credential, and a GET
  invites a retry, a prefetch, or a link. Put the flag that forces a new password in the
  query string (`?rotate=true`), never the password itself in a URL.
- **Set `Cache-Control: no-store` on the response.** Without it the body is fair game for
  every proxy and for the browser's back/forward cache.
- **Scope with `enforce_resource_scope`,** not just `enforce_customer_scope`: the caller
  names a resource id, so the check is that *this* extension belongs to the authenticated
  customer. A customer-scoped query that never looks at the row's owner returns another
  tenant's credential to anyone who can guess a UUID.
- **Log the subject, never the secret.** `extension_id`, `rotated=true` — never the
  password, and never the whole response object.
- **Reuse before rotating.** Re-issuing the stored password keeps a second tab, or a
  reload, from knocking the first one offline. Rotation is the *revocation* path: it is
  what makes a leaked credential stop working, so it must stay explicit rather than being
  a side effect of asking for the credential again.

`tests/unit/test_rest_extensions.py` covers the three that are observable from outside —
the `no-store` header, reuse across two calls, and the cross-tenant 403.
