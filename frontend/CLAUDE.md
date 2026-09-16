# Frontend

Vite proxies `/api`, `/auth`, `/vsapi`, `/vg`, and `/health` to the backend.
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

## Which port your dev server is on

**A worktree does not serve on `:5173`, and opening it anyway shows you another
checkout's build.** That page renders perfectly and is simply the wrong one, so a
screenshot taken of it is evidence about code you did not edit — the failure this
section exists to stop, which has cost sessions a couple of rounds each before anyone
noticed.

| Where Vite runs | Port |
| --- | --- |
| `docker compose` (`./frontend:/app`) | the host's `FRONTEND_HOST_PORT`, mapped onto a container that always serves 5173 |
| host `npm run dev`, ordinary checkout | 5173 |
| host `npm run dev`, worktree | `5173 + portOffset(<worktree dir>)`, in `5174..5188` |

The offset is derived from the worktree's directory name — stable across restarts, and
needing no `.env`, because most of the ways a worktree is cut here run no project
code at the time. `src/worktreePort.ts` carries why that is derived rather than leased from
devkit's `ports.toml`, which allocates the published `FRONTEND_HOST_PORT` and not this.

Don't compute it: **read the port off Vite's startup line**, which is the one source
that is right in all three rows. `strictPort: true` means there is no fourth case where
it quietly slid somewhere else — a collision (two worktrees hashing alike, or a derived
port meeting a leased `FRONTEND_HOST_PORT`) is a startup error, and
`VITE_PORT=5186 npm run dev` steps around it. `VITE_PREVIEW_PORT` does the same for
`npm run preview`, which takes the same offset over base 4173.

Verify frontend changes with `npm run test:run` and `npm run lint` from this directory.

Run the whole of `lint`, not one of its parts. It chains five checks —
`lint:eslint`, `lint:types`, `lint:css`, `lint:spelling`, `lint:deadweight` — and
`lint:spelling` (cspell) rejects unknown words in `.ts`/`.tsx` as readily as in prose,
so an ordinary identifier can fail CI having passed `lint:types` locally. There is no
`typecheck` script; type checking is `lint:types`, which is **two** `tsc` runs: the app
(`tsconfig.json`, `src/` only) and then the config project (`tsconfig.node.json` —
`vite.config.ts` and the policy modules it imports). The second was added because
nothing checked it: `tsc --noEmit` alone builds no referenced project, so the config
had accumulated two type errors that only showed to whoever opened it in an editor.

## `?slow=1` is how you look at a loading screen

**Every loading screen in the app is invisible on a warm dev machine, and that is by
design.** Each of the three gates — the skin chunk (`skins/context.tsx`), the session
(`App.tsx`), the comic-book page's pictures (`skins/comic-book/Layout.tsx`) — draws
nothing for the first 200–400 ms, so a cached load opens the gate inside its own debounce
and the screen never paints at all. The exit animations are where that bites: the
comic-book sheet washes away into the page it was covering, and a transition you cannot
see run is a transition you cannot tune.

`?slow=1` drops all three debounces to zero and holds each gate for a second, so each
screen paints and each transition plays at a cold visitor's pace. `?slow=<ms>` picks a
different hold (capped at 30 s) when a second is not long enough; `?slow=0` turns it off,
and in between it is remembered in `localStorage['loading:slow']` so switching skins from
the picker — which drops the query but does re-run the chunk gate — stays slow.

Each gate holds for its *own* second rather than sharing one deadline. A shared deadline
would be spent by the first gate, and the last one, the only one with a transition to
show, would never hold at all.

`lib/slowLoading.ts` is the flag and the promise-side hold; `hooks/useSlowLoading.ts` is
the hook the two boolean gates report through. **It costs a production build nothing**,
which is the bar `?sim=1`, `?smsSim=1` and `?callSim=1` already meet: the flag is behind
`import.meta.env.DEV` and folds away, and because a hook cannot be called conditionally,
`useSlowReady` is *chosen* at build time — the real hook in development, the identity on
`ready` in a build. Reverting that fold is not free and not invisible: it puts the total
JavaScript 12 bytes over `bundlePolicy.ts`'s ratchet, so `npm run test:bundle` fails.

## What a visitor downloads has three budgets, and they do not overlap

Nothing in a bundler complains about weight, so each of these is a file of ratchets and
a test that reads them. Together they are the only thing that fails when the app gets
heavier; separately they cover three tiers a change can add weight to, and a finding
tells you which.

| File | Bounds | Run by |
| --- | --- | --- |
| `assetPolicy.ts` | what one page fetches out of `public/` | `test:run` |
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

A cap is a poor way to say *this particular thing must not ship*, though, and two guards
say it directly rather than waiting for a number to move: `DEV_ONLY_MARKERS` greps the
built JavaScript for a string only the comic-book editor engine needs, and
`src/tests/skins/editorEngineIsolation.test.ts` walks the page's static value-import
graph without needing a build. Both exist because the engine sat in the shipped bundle
through five consecutive ceiling raises — the raises were all anyone saw.

## `src/lib/phoneMetadata.json` is generated; do not edit it

`libphonenumber-js` carries every numbering plan on earth and the skin needs a few.
`phoneMetadata.ts` says which and why, `phoneMetadataGen.ts` writes the table, and
`npm run gen:phone-metadata` is how you regenerate it — after changing the country list,
and after any upgrade of the package. `phoneMetadata.test.ts` fails when the committed
file is not what the generator would write, so a Dependabot bump that revises a plan
shows up as a reviewable diff instead of as numbers that quietly stop parsing.

Which countries belong in that list is answerable rather than a matter of taste:
`python scripts/phone-countries.py` reads the numbers already in the database and reports
the plans in use, naming any the table does not carry and any it carries for nobody.
