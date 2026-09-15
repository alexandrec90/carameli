// The one accent each route gets (`.claude/rules/skin-comic-book.md`, Palette): it colours
// the loading screen's dot grid, the page-transition wash and the letterbox around the page.
// The grid darkens it as far as reading on paper takes (`gridInk`), so an accent here is
// chosen for the page, not for its contrast.
//
// `skins/context.tsx` calls this before the skin's chunk exists, so keep the module free
// of imports: it is on the eager path with `benDayGrid.ts` and `spotlight.ts`.

/** Route path → accent. `PAGE_FALLBACK_ACCENT` covers everything else. */
export const PAGE_ACCENTS: Record<string, string> = {
    '/': '#FFE033',
    '/phone-lines': '#0057B8',
    '/extensions': '#E8003D',
}

/** The accent of every route without an entry of its own. */
export const PAGE_FALLBACK_ACCENT = '#00AEEF'

export function accentForPath(path: string): string {
    return PAGE_ACCENTS[path] ?? PAGE_FALLBACK_ACCENT
}
