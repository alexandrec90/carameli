import { useLocation, useNavigate } from 'react-router-dom'

import { logger } from '../../../lib/logger'
import type { NavItem } from '../../../routes'
import { LOADING_PAGE_VALUE, pageSelectValue, resolvePageSelection } from './pageSelection'

export interface PageSelectProps {
  navItems: NavItem[]
  previewingLoading: boolean
  onPreviewLoading(on: boolean): void
}

/**
 * Toolbar dropdown that switches the page being edited. The editor overlay
 * blocks the panels' own click navigation, so this is the only way to move
 * between pages in edit mode. Picking a page replays the Ben-Day wash
 * transition; the extra "Loading screen" entry previews the loading overlay,
 * and leaving it replays the loading screen's exit wash.
 */
export default function PageSelect({
  navItems,
  previewingLoading,
  onPreviewLoading,
}: PageSelectProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const value = pageSelectValue(previewingLoading, location.pathname)
  const knownPath = navItems.some(item => item.path === location.pathname)

  const onChange = (next: string) => {
    const sel = resolvePageSelection(next, location.pathname)
    logger.info('Comic-book editor: page selected', { value: next, ...sel })
    onPreviewLoading(sel.previewLoading)
    if (sel.navigateTo) navigate(sel.navigateTo)
  }

  return (
    <label className="cb-ed-field">
      <span>Page</span>
      <select
        className="cb-ed-select"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {navItems.map(item => (
          <option key={item.path} value={item.path}>{item.label}</option>
        ))}
        {!knownPath && <option value={location.pathname}>{location.pathname}</option>}
        <option value={LOADING_PAGE_VALUE}>Loading screen</option>
      </select>
    </label>
  )
}
