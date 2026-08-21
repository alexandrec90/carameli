# Frontend

Vite serves on `:5173` and proxies `/vsapi`, `/vg`, and `/health` to the backend.
Browser authentication uses the HttpOnly session cookie from `/auth/session`; never put
an API key or provider credential in the bundle.

- Hooks own API access and state. Pages select a hook and a skin view. Skins render the
  supplied data and must not fetch it themselves.
- Shared helpers/constants belong in `src/lib/`; do not duplicate formatters or wire
  literals across hooks/components.
- Keep frontend variables `camelCase`; map external wire shapes explicitly at the API
  boundary.
- Prefer derived values over effects that mirror state.
- Use `src/lib/logger.ts` for unexpected states and caught failures. It already batches
  authenticated entries to `/vg/1.0.0/frontend-logs`; never log secrets or message bodies.
- Follow `.claude/rules/skin-architecture.md` and the active skin's scoped rule for skin
  work. Use the `add-skin` skill only when creating an entirely new skin.

Verify frontend changes with `npm run test:run` and `npm run lint` from this directory.

Run the whole of `lint`, not one of its parts. It chains five checks —
`lint:eslint`, `lint:types`, `lint:css`, `lint:spelling`, `lint:deadweight` — and
`lint:spelling` (cspell) rejects unknown words in `.ts`/`.tsx` as readily as in prose,
so an ordinary identifier can fail CI having passed `lint:types` locally. There is no
`typecheck` script; type checking is `lint:types` (`tsc --noEmit`).

## What a visitor downloads has three budgets, and they do not overlap

Nothing in a bundler complains about weight, so each of these is a file of ratchets and
a test that reads them. Together they are the only thing that fails when the app gets
heavier; separately they cover three tiers a change can add weight to, and a finding
tells you which.

| File | Bounds | Run by |
| --- | --- | --- |
| `assetPolicy.ts` | `public/`, copied into `dist/` verbatim | `test:run` |
| `bundlePolicy.ts` | `dist/` — chunks, CSS, fonts | `test:bundle` |
| `knip.ts` | code and dependencies nothing imports | `lint:deadweight` |

`test:bundle` is separate from `test:run` because it builds first and then measures the
result: the budgets fail rather than skip when there is no `dist/`, which is right for
the gate and wrong for a suite anyone runs on an unbuilt tree.

Nothing here needs running by hand to be enforced. The PR gate runs `test:run` and
`test:bundle` in its frontend job and `lint` (which chains `lint:deadweight`) in its
lint job. Locally the same three are reachable from `scripts/run-tests.py`:
`--target frontend-tests`, `--target bundle-budgets`, or `--all` for both, which is
what the desktop task *Test: Run Carameli Target — free* dispatches.

The third row is the one whose absence is easy to miss, because unused code costs zero
shipped bytes — Vite tree-shakes it — and everything else: install time in every CI job,
a Dependabot PR per release, an audit surface. Five three.js packages sat in
`dependencies` on exactly that basis until `knip` was added.

**Raising a number in any of the three is a decision about what visitors download**, and
a one-line diff is what makes it read like one in review. Every cap sits just above
today's cost on purpose: a budget's value is that it fails on the way up.
