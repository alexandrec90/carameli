import { linkedPairs, tubeBetween } from './bubbleTube'
import type { TubeGeometry } from './bubbleTube'
import { bubbleRect } from './editor/transforms'
import type { BubbleTransform } from './editor/types'
import type { PanelPoly } from './Layout'

interface BubbleTubesProps {
  polys: PanelPoly[]
  bubbles: BubbleTransform[]
  /** Whether panel `index`'s bubble is currently revealed. */
  isVisible(index: number): boolean
}

interface Tube {
  key: string
  geo: TubeGeometry
  visible: boolean
}

/**
 * Connector tubes between linked bubbles, on a single viewport-level SVG.
 *
 * It has to be viewport-level: a link joins bubbles in two different panels, so the
 * corridor lives in the gutter between them and belongs to neither. And it has to
 * paint above the bubbles — that is what welds each corridor into both mouths (see
 * bubbleTube.ts).
 *
 * Every tube is rendered whenever its pair is linked and only faded by `visible`,
 * rather than mounted and unmounted, so a tube appears and disappears on the same
 * transition as the bubbles it joins instead of popping a frame ahead of them.
 */
export default function BubbleTubes({ polys, bubbles, isVisible }: BubbleTubesProps) {
  const tubes = linkedPairs(bubbles).reduce<Tube[]>((acc, [i, j]) => {
    if (!polys[i] || !polys[j]) return acc
    const geo = tubeBetween(
      bubbleRect(polys[i].bounds, bubbles[i]),
      bubbleRect(polys[j].bounds, bubbles[j]),
    )
    if (geo) acc.push({ key: `${i}-${j}`, geo, visible: isVisible(i) && isVisible(j) })
    return acc
  }, [])

  if (tubes.length === 0) return null

  return (
    <svg className="cb-tube-svg" aria-hidden="true">
      {tubes.map(t => (
        <g key={t.key} className={`cb-tube${t.visible ? ' is-visible' : ''}`}>
          <path className="cb-tube-fill" d={t.geo.fill} />
          {t.geo.rails.map((d, r) => (
            <path key={r} className="cb-tube-rail" d={d} />
          ))}
        </g>
      ))}
    </svg>
  )
}
