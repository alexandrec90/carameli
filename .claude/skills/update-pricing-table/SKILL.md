---
name: update-pricing-table
description: 'Audit the current tech stack and carrier integrations against charts/pricing/pricing table.md and update any sections that are missing, stale, or incorrectly priced. Covers Telnyx rates, infrastructure tiers, S3 storage, and scaling model.'
argument-hint: 'Optional: describe what changed (e.g., "added Twilio as second carrier", "added CDN layer"). If omitted, performs a full scan.'
---

# Skill: Update Pricing Table

Audit every cost-bearing component in the codebase against
`charts/pricing/pricing table.md` and patch the file where sections are
missing, stale, or incorrectly reflect the current architecture.

---

## Step 1 — Read the Source Files

Read all of the following **in parallel**:

| File | What to look for |
|------|-----------------|
| `docker-compose.yml` | Every service block — these are the infrastructure components with a runtime cost |
| `requirements.txt` | External SaaS packages: carrier SDKs (telnyx, twilio, vonage…), object-storage clients (boto3, aiobotocore…), any new billable integration |
| `app/core/config.py` | Env-var groups for external services — each group is a potential cost line |
| `app/services/providers/carrier/` | Active carrier module(s) — determines which §1 pricing section to include |
| `app/services/providers/engine/` | Active call engine module(s) — determines Jambonz vs. a hosted alternative |
| `CLAUDE.md` | Tech stack table — authoritative ground truth for component names and roles |
| `charts/tech stack/tech stack legend.md` | Current runtime component list — use to detect any component not yet reflected in the pricing table |
| `charts/pricing/pricing table.md` | Current pricing table — the diff target |

---

## Step 2 — Build the Canonical Cost Component List

From the evidence gathered, create an internal list of **cost-bearing
components** with:

| Field | Description |
|-------|-------------|
| `component` | Short label matching the tech stack legend (e.g. "Phone Carrier") |
| `billing_model` | `per_unit` / `per_month_flat` / `usage_tiered` / `self_hosted` |
| `current_section` | Which `##` section in the pricing table already covers it (or "missing") |
| `action` | `ok` / `add` / `update` / `remove` |
| `evidence` | Which file confirmed the component |

### Inclusion rules

Include a component **only if** it has a real monetary cost in production:

- **Always include:** phone carrier (Telnyx or replacement), call engine if
  hosted/metered, object/file storage (S3 or alternative), server infrastructure
- **Include if present:** CDN, managed database service, a second carrier,
  STIR/SHAKEN signing service, email delivery (SendGrid etc.), monitoring SaaS
  (Datadog, New Relic etc.)
- **Never include:** open-source components that are self-hosted with no per-unit
  or per-seat fee (Redis, PostgreSQL, Grafana, Prometheus, PgBouncer — their cost
  comes from the server they run on, already covered in the infrastructure tier
  table); dev/test tooling

### Carrier detection

Read the active carrier module in `app/services/providers/carrier/`. The pricing
section for that carrier must exist and reference the correct pricing URL and
rates. If the carrier has changed (e.g. Telnyx → Twilio), **replace §1** — do
not leave rates for an inactive carrier.

---

## Step 3 — Diff Against Current Pricing Table

Compare the canonical list from Step 2 against the current
`charts/pricing/pricing table.md`:

| Diff type | Description |
|-----------|-------------|
| **Missing section** | A cost-bearing component has no section/row in the table |
| **Stale carrier** | §1 lists a carrier that no longer matches the active provider module |
| **Stale rate** | A rate value in the table diverges from well-known published pricing (mark for human review — do not silently guess) |
| **Missing scaling row** | §4 scaling tier table lacks a column for a new cost-bearing component |
| **Stale infrastructure tier** | A service in `docker-compose.yml` implies a new resource constraint not reflected in the server tier descriptions |
| **Stale "Key Cost Drivers" row** | §6 lacks an entry for a cost-bearing component that significantly impacts scaling |

If **no diff is found**, print:

```text
Pricing table is up to date — no changes needed.
```

and stop.

---

## Step 4 — Apply Updates

### Rules for all edits

- Preserve all existing sections and rows that are still accurate — do not
  rewrite prose unless it is materially wrong.
- Keep the document structure: `##` sections numbered in order, tables
  followed by blockquote caveats.
- Rates you are **confident** about (same carrier, verified from public pricing
  page): update directly.
- Rates you are **unsure** about (new carrier, rate changes since training data):
  add the row with the best available estimate and append a
  `> ⚠ Unverified — confirm at <pricing URL>` blockquote underneath.
- Always update the `> **Last updated:**` line at the top to the current month
  and year.

### 4a — §1 Variable Costs (Carrier)

If the active carrier is unchanged (still Telnyx), check whether any new
billable feature has been added to the carrier module (e.g. STIR/SHAKEN,
number porting, fax) and add rows if needed.

If the carrier has **changed**, replace the entire §1 content with a new
section that uses the same table structure for the new carrier's:

- DID/number monthly cost
- Outbound and inbound voice per-minute rates
- SMS / MMS per-segment rates
- Any registration or subscription fees (e.g. 10DLC brand, short code)

### 4b — §2 Infrastructure Costs

If `docker-compose.yml` has gained a new service (e.g. a CDN sidecar, a
second database replica, a vector store), add a new subsection under §2 with
the same format:

```markdown
### <Service Name>

| Item | Rate |
|------|------|
| ... | ... |
```

Only add a server tier row change if the new service meaningfully changes
the minimum server requirement (e.g. a GPU inference service bumps the
"Micro" tier floor).

### 4c — §3 Unit Cost Reference

If a new billable action exists (e.g. "fax page sent", "carrier lookup"),
add a row:

```markdown
| <action label> | <assumptions> | $X.XXX |
```

Recalculate the unit cost using the same formula pattern already in the
table.

### 4d — §4 Scaling Cost Model

If a new carrier or storage service is added:

1. Add a new column to the **Monthly Cost Estimates** table.
2. Add the new variable to the **Assumptions Used** table.
3. Update every tier row's **Total / mo** to include the new cost.
4. Append a new block to the **Detailed Breakdown** section showing the math
   for the Starter tier as a worked example (matching the existing code-block
   format).

### 4e — §5 Cost-Per-Agent Benchmark

Recalculate rows only if per-unit carrier rates have changed. Keep the same
five agent-count rows.

### 4f — §6 Key Cost Drivers

If a new cost-bearing component is added that materially affects the scaling
curve (e.g. a per-lookup carrier surcharge, a CDN egress fee), append a row:

```markdown
| **<Component>** | <One-sentence plain-English impact> |
```

---

## Step 5 — Verify

After editing, re-read `charts/pricing/pricing table.md` and confirm:

- [ ] `> **Last updated:**` reflects the current month/year
- [ ] No section references a carrier, service, or rate that no longer
      applies
- [ ] Every new cost-bearing component from Step 2 appears somewhere in the
      table
- [ ] §4 tier totals are arithmetic sums of their constituent columns
- [ ] Any unverified rate has a blockquote warning immediately below it
