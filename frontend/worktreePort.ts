import { basename, sep } from 'node:path'

/**
 * Which port offset this checkout's dev server takes, derived from where it sits on
 * disk.
 *
 * ## The problem
 *
 * `server.port` was the bare constant 5173 with no `strictPort`, so a second
 * `npm run dev` on this machine did not fail — it slid to the next free port and said
 * so in one line of startup output. What an agent then has is a server on 5175 (5173
 * and 5174 being whatever else was up) and a habit of opening 5173, which answers
 * perfectly with *another checkout's build*. Nothing about that page says it is the
 * wrong one, so the rounds spent screenshotting it are rounds spent drawing
 * conclusions about code that was never edited.
 *
 * `strictPort: true` turns that into a startup error, and this module is what stops
 * the startup error from being the new normal: each worktree derives its own port, so
 * two dev servers coexist with nothing configured.
 *
 * ## Why derived, when this project already has a port registry
 *
 * devkit's `ports.toml` is the machine-wide registry, and it is not being bypassed
 * here — it covers a different server. What it allocates is `FRONTEND_HOST_PORT`, the
 * *host* side of `docker-compose.yml`'s `${FRONTEND_HOST_PORT:-5173}:5173`, for a
 * checkout that publishes a Docker stack. The dev server this file is about is the
 * host-Vite one: `npm --prefix frontend run dev`, the branch-preview path the config's
 * proxy comments describe, which publishes nothing and holds no lease.
 *
 * That path cannot be given a lease at cut time, because a worktree gets cut three
 * ways here and devkit's code runs in one of them:
 *
 * | how | who cuts it | devkit code runs |
 * | --- | --- | --- |
 * | `claude --worktree <topic>` | Claude Code | no |
 * | devkit's `worktree.py` box (the VS Code task; Codex's only route) | devkit | yes |
 * | Claude Remote Control with `"spawn": "worktree"` | Claude Code | no |
 *
 * So nothing done when a worktree is cut — seeding `.env`, taking a lease — reaches
 * two of the three. A `claude --worktree` box seeds its `.env` from the source
 * checkout, which means it names the *primary's* ports; that is the same shape as the
 * incident `CLAUDE.md` records under DB-backed tests, where a box's `.env` pointed at
 * the primary's database. Advice does not hold here. A derivation does.
 *
 * What all three ways share is where they land: `<repo>/.claude/worktrees/<name>` (or
 * the box tier's `<workspace>/.worktrees/<name>`). And the program that needs to know
 * the port is this one, which runs identically in all three.
 *
 * ## The container is slot 0, and that is load-bearing
 *
 * The compose `frontend` service bind-mounts `./frontend:/app` and runs Vite there, so
 * the config sees `/app` — a path carrying no worktree segment, whatever tree it came
 * from. `portOffset` therefore returns 0 inside every container, the container keeps
 * listening on 5173, and `${FRONTEND_HOST_PORT:-5173}:5173` keeps mapping onto
 * something. If this ever derived from the branch or from an env var instead of from
 * the directory, every compose stack would publish a port with nothing behind it —
 * see the test that pins it.
 *
 * ## What it gives up
 *
 * A hash, not an allocator: two worktrees can collide, and so can a derived port and a
 * `FRONTEND_HOST_PORT` some other stack legitimately leased — both live in the same
 * 5173..5188 span by design (see `SLOT_SPAN`). That is what `strictPort: true` is for.
 * A collision is an immediate, legible startup error and `VITE_PORT=5186 npm run dev`
 * steps around it; the alternative is a second registry with a lock and a reaper,
 * which is machinery this path exists to avoid.
 *
 * An ordinary checkout always returns 0, so `localhost:5173` keeps meaning what it has
 * always meant — every bookmark, `scripts/run-e2e.py`, `scripts/run-ci.py` and
 * `CORS_ORIGINS` default included — and a given worktree keeps its port across
 * restarts, so a bookmarked `localhost:5179` stays valid for as long as that worktree.
 */

/** Directories a worktree is cut into, relative to the checkout above them. */
const WORKTREE_DIRS = [['.claude', 'worktrees'], ['.worktrees']]

/**
 * How many distinct offsets exist, including 0. Matches `registry.max_slots` in
 * devkit's `ports.toml`, which is also the minimum spacing that file enforces between
 * any two service bases. Sharing the number keeps a derived dev port inside the
 * frontend base's reserved span (5173..5188) rather than wandering into the next
 * service's — the property `ports.toml`'s `validate()` exists to guarantee, and one a
 * second, wider span here would quietly break.
 */
export const SLOT_SPAN = 16

/**
 * The worktree name in `dir`, or '' when `dir` is an ordinary checkout.
 *
 * Matched on the path segments above the leaf rather than on a substring, so a
 * checkout that merely *contains* the words — `~/code/worktrees-talk/demo` — is not
 * mistaken for one, and a repository legitimately named `.worktrees` is not either.
 */
export function worktreeName(dir: string): string {
  const parts = dir.split(sep).filter(Boolean)
  return WORKTREE_DIRS.some(
    marker =>
      parts.length > marker.length &&
      marker.every((segment, i) => parts[parts.length - 1 - marker.length + i] === segment),
  )
    ? basename(dir)
    : ''
}

/**
 * A stable non-zero number for `name`, in `1..span-1`.
 *
 * FNV-1a, written out rather than imported: this file is loaded by the Vite config, so
 * it has to stay dependency-free, and the hash only needs to spread short directory
 * names evenly. `>>> 0` after each step keeps it in unsigned 32-bit space, which is
 * what makes the result identical on every platform — the property a bookmarked port
 * depends on.
 */
export function slotFor(name: string, span: number = SLOT_SPAN): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < name.length; i += 1) {
    hash = ((hash ^ name.charCodeAt(i)) >>> 0) * 0x01000193
    hash >>>= 0
  }
  return 1 + (hash % (span - 1))
}

/**
 * The offset to add to every conventional base for the checkout at `dir`.
 *
 * 0 for an ordinary checkout and for the container, so the familiar port keeps
 * working; a stable `1..span-1` for a worktree. Applied to the dev and preview bases
 * together, so one worktree's pair moves as a pair and stays easy to reason about.
 */
export function portOffset(dir: string, span: number = SLOT_SPAN): number {
  const name = worktreeName(dir)
  return name === '' ? 0 : slotFor(name, span)
}
