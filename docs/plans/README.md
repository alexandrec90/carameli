# Implementation plans

Session-sized plans for coding agents. Each plan is self-contained: a fresh session should read
[CLAUDE.md](../../CLAUDE.md) (hard rules), the plan, and the files it links — nothing else is
assumed.

- [`active/`](active/) — open or partially completed work
- [`completed/`](completed/) — landed work kept for its implementation or decision record

A multi-session track is a folder whose `README.md` (or `00-overview.md`) holds the shared
context; read it before any phase file. A single-session plan is one file.

## Active

| Track | Delivers | Shape |
| --- | --- | --- |
| [airtight-vanillasoft/](active/airtight-vanillasoft/) | Every Carameli ⇄ VanillaSoft integration error lands somewhere a local agent can read, plus a live E2E suite | `00-overview.md` + phases 01–05, in order |
| [data-scaling/](active/data-scaling/) | Indexes, retention + S3 lifecycle, backups, Sentry, metrics/alerting, ops hardening | `00-overview.md` + phases 01–06, in order |
| [dual-vendor/](active/dual-vendor/) | Carameli and Cloudli serving different customers at the same time: vendor-neutral seam, per-line routing, capability split | `00-overview.md` + phases 01–07 |
| [fixer-feedback-loop/](active/fixer-feedback-loop/) | Cost-aware fixer optimization on top of the Stop-hook profile (plan 1 is already merged) | `README.md` + plans 2–4 |
| [frontend-parity/](active/frontend-parity/) | Front-end parity with Cloudli's 39 pages via the `DataPage` system | `README.md` + plans A and B |
| [shared-devkit/](active/shared-devkit/) | Carameli's project-agnostic tooling extracted into the shared `alexandrec90/devkit` upstream | `README.md` + plans 1–5 |
| [test-coverage/](active/test-coverage/) | Backend unit gaps, frontend, provider integration, tooling, CI wiring | `README.md` + tracks A–E |
| [test-implementation-checklist.md](active/test-implementation-checklist.md) | Blue-sky testing roadmap assuming full credentials and infra | single file |
| [test-speedup-plan.md](active/test-speedup-plan.md) | Remaining test-suite performance work scoped out of the first pass | single file |

## Completed

| Track | Record |
| --- | --- |
| [comic-book-editor/](completed/comic-book-editor/) | Dev-only in-app editor for moving/resizing `comic-book` skin panels, with export back to source |
