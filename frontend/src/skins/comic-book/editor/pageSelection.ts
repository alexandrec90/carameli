// Pure helpers for the editor's page selector — kept React-free for unit tests.

/** Sentinel <option> value for previewing the loading screen. */
export const LOADING_PAGE_VALUE = '__loading__'

export interface PageSelection {
  /** Whether the loading-screen preview should be active after this choice. */
  previewLoading: boolean
  /** Route to navigate to, or null when no navigation is needed. */
  navigateTo: string | null
}

/** The <select> value that represents what the editor is currently viewing. */
export function pageSelectValue(previewingLoading: boolean, pathname: string): string {
  return previewingLoading ? LOADING_PAGE_VALUE : pathname
}

/** Map a dropdown choice to the preview flag + navigation it implies. */
export function resolvePageSelection(value: string, currentPath: string): PageSelection {
  if (value === LOADING_PAGE_VALUE) return { previewLoading: true, navigateTo: null }
  return { previewLoading: false, navigateTo: value === currentPath ? null : value }
}
