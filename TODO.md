# TODO

Status of the build-out.
Keep this file updated as items land — check things off, don't delete them.
Larger, multi-session work lives in [docs/plans/](docs/plans/); this file is the backlog
and the pointer to it.

## Architecture & Docs

- [ ] is license cost included in price chart?

## Infrastructure & DevOps

- [ ] Github actions after deployment - production environment + CD workflow + OIDC + secret scanning
- [x] ~~*gh secret/vars + a sandbox environment → one manually-dispatched paid/sandbox test workflow*~~ [2026-07-16]
- [x] ~~*CI tests temporarily disabled: pr-gate.yml (re-enabled — fires on PR to master), nightly.yml + weekly.yml (re-enabled schedules)*~~ [2026-07-14]

## Testing & Integration

- [ ] run ngrok and run associated tests
- [ ] Set up and test VANILLASOFT_WEBHOOK_URL
- [ ] Run `python scripts/run-load.py` (performance)
- [ ] Run `python scripts/run-mutation.py` (mutation score)
- [x] ~~*re-enable github actions — pre-commit/pre-push hooks and the `ci.yml` / `e2e-smoke.yml` workflows renamed back from `.disabled`*~~ [2026-07-14]
- [x] ~~*asyncpg.exceptions.InvalidPasswordError: password authentication failed for user "carameli"*~~ [2026-07-16]
- [x] ~~*Separate paid and free tests*~~ [2026-07-14]

## UI / Frontend

- [ ] make panels wrappable when page is resized
- [ ] also play with "speed/action lines", radial sunburst lines instead of dots
- [ ] backgrounds also don't need to be solid white - you could have light blue background with dark blue dots
- [ ] ui performance issues
- [ ] loading screen shouldn't "flash" for quick loads, it's jarring
- [ ] scrape metadata from images
- [ ] maybe add tests to check if ui components/images are properly compressed - maybe test for performance bottlenecks?
- [ ] make transitions slower so I can actually see it

## Done

Entries before 2026-06 were trimmed on 2026-07-27 — recover them with
`git log -p -- TODO.md` if ever needed.

- [x] ~~*Run fix all skill*~~ [2026-07-10]
- [x] ~~*set TELNYX_SANDBOX=1 to test telnyx*~~ [2026-07-10]
- [x] ~~*Test: Run pytest (backend pytest tests)*~~ [2026-07-10]
- [x] ~~*Test: Run Frontend (Vitest)*~~ [2026-07-10]
- [x] ~~*Test: Run E2E (headless) (or Test: Run E2E (cross-browser))*~~ [2026-07-10]
- [x] ~~*Test: Run Telnyx Sandbox (only when sandbox creds are configured)*~~ [2026-07-10]
- [x] ~~*Figure out ui transitions - ben day dot ripple from corner, washing away content?*~~ [2026-07-10]
- [x] ~~*remove page misregistration transitions*~~ [2026-07-10]
- [x] ~~*UI components: images/characters (nested inside panels), panel layout, ben-day dot backgrounds, speech bubbles*~~ [2026-07-10]
- [x] ~~*add "gradient" effect to ben-day dot backgrounds (dot density can vary throughout panel)*~~ [2026-07-10]
- [x] ~~*logo top left should be smaller - panel can taper up toward top left not to squeeze other panels*~~ [2026-07-10]
- [x] ~~*figure out a way to easily move/scale images in panels - make editor!*~~ [2026-07-10] → see [docs/plans/completed/comic-book-editor/](docs/plans/completed/comic-book-editor/)
- [x] ~~*Postgres extension - why is server still listed as "voicegateway"?*~~ [2026-07-07]
- [x] ~~*come up with comprehensive checklist of things you still need like run ngrok, set up telnyx, get phone numbers, plug vanillaland endpoints, etc. - mostly to set up more tests*~~ [2026-07-03] → see [docs/prototype-roadmap.md](docs/prototype-roadmap.md) (Workstream C + milestones)
- [x] ~~*I want to keep a closer eye on fixer performance - is all agent activity tracked? Token cost, tool calls, etc. Should I also keep timestamped error logs for reference?*~~ [2026-06-27]
- [x] ~~*add an argument to fixers to disambiguate between mobile and desktop*~~ [2026-06-27]
- [x] ~~*add a test for argument-less fixer determining whether they're running on mobile or desktop*~~ [2026-06-27]
- [x] ~~*Test: Run E2E (headless) output isn't standard relative to others - also make sure all test output is standard - minimal terminal noise, filtered, actionable output to artifact file. Also update corresponding fixer skill.*~~ [2026-06-25]
- [x] ~~*run the front-end parity plans A and B*~~ [2026-06-25] → remaining batches tracked in [docs/plans/active/frontend-parity/](docs/plans/active/frontend-parity/)
- [x] ~~*check cloudli UI against what's implemented*~~ [2026-06-24]
- [x] ~~*understand why state.json are not all file scoped*~~ [2026-06-24]
- [x] ~~*run skill to fix vibe coded design flaws*~~ [2026-06-24]
- [x] ~~*check for mentions of bash - should use powershell*~~ [2026-06-24]
- [x] ~~*there should be a task that runs all tests? is there already?*~~ [2026-06-24]
- [x] ~~*remove all PS1 references/constraints*~~ [2026-06-24]
- [x] ~~*do skill workflows involve tasks at all? or running scripts? are they optimal?*~~ [2026-06-24]
- [x] ~~*revisit task first architecture - is coding agent ever instructed to only operate through tasks? is that really most efficient?*~~ [2026-06-24]
