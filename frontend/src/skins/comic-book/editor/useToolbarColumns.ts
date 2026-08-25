import { useLayoutEffect, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

const COLUMN_WIDTH = 220
const COLUMN_GAP = 12
const TOOLBAR_CHROME_X = 26
const TOOLBAR_CHROME_Y = 22
const DOCK_MARGIN = 12

interface Size {
  width: number
  height: number
}

interface ToolbarLayout {
  columns: number
  width: number
}

/** Balance one-column content without letting the toolbar grow beyond the viewport. */
export function toolbarLayout(contentHeight: number, viewport: Size): ToolbarLayout {
  const maxContentHeight = Math.max(1, viewport.height / 2 - TOOLBAR_CHROME_Y)
  const neededColumns = Math.max(1, Math.ceil(contentHeight / maxContentHeight))
  const availableWidth = Math.max(0, viewport.width - DOCK_MARGIN)
  const fittingColumns = Math.max(
    1,
    Math.floor((availableWidth - TOOLBAR_CHROME_X + COLUMN_GAP) / (COLUMN_WIDTH + COLUMN_GAP)),
  )
  const columns = Math.min(neededColumns, fittingColumns)

  return {
    columns,
    width: TOOLBAR_CHROME_X + columns * COLUMN_WIDTH + (columns - 1) * COLUMN_GAP,
  }
}

/** Sum the toolbar's unbreakable blocks; each keeps the same width in every column. */
function toolbarContentHeight(toolbar: HTMLElement): number {
  const view = toolbar.ownerDocument.defaultView
  return Array.from(toolbar.children).reduce((height, child) => {
    if (!(child instanceof HTMLElement)) return height
    const style = view?.getComputedStyle(child)
    const marginTop = Number.parseFloat(style?.marginTop ?? '') || 0
    const marginBottom = Number.parseFloat(style?.marginBottom ?? '') || 0
    return height + child.getBoundingClientRect().height + marginTop + marginBottom
  }, 0)
}

/** Rebalance whenever selection controls or the viewport change. */
export function useToolbarColumns(
  ref: RefObject<HTMLDivElement | null>,
): Pick<CSSProperties, 'columnCount' | 'width'> {
  const [layout, setLayout] = useState<ToolbarLayout>({ columns: 1, width: 246 })

  useLayoutEffect(() => {
    const toolbar = ref.current
    if (!toolbar) return

    const update = () => {
      const next = toolbarLayout(toolbarContentHeight(toolbar), {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      setLayout(current =>
        current.columns === next.columns && current.width === next.width ? current : next,
      )
    }

    update()
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(toolbar)
    const mutationObserver = new MutationObserver(update)
    mutationObserver.observe(toolbar, { childList: true, subtree: true, characterData: true })
    window.addEventListener('resize', update)

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [ref])

  return { columnCount: layout.columns, width: layout.width }
}
