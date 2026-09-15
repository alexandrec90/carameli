// The one accent each route gets (`.claude/rules/skin-comic-book.md`, Palette): it colours
// the loading screen's dot grid, the page-transition wash and the letterbox around the page.

const PAGE_ACCENT: Record<string, string> = {
    '/': '#FFE033',
    '/phone-lines': '#0057B8',
    '/extensions': '#E8003D',
}

export function accentForPath(path: string): string {
    return PAGE_ACCENT[path] ?? '#00AEEF'
}
