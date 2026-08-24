import { linkedPairs, tubeBetween } from './bubbleTube'
import type { TubeGeometry } from './bubbleTube'
import { bubbleRect } from './editor/transforms'
import type { BubbleTransform } from './editor/types'
import type { PanelPoly } from './panelGeometry'

interface BubbleTubesProps {
  polys: PanelPoly[]
  bubbles: BubbleTransform[]
  /** Whether bubble `index` is currently revealed. */
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
 * It has to be viewport-level: bubbles spill past their panel's edge, so a corridor
 * joining two of them routinely crosses into the gutter and cannot be clipped to
 * either. And it has to paint above the bubbles — that is what welds each corridor
 * into both mouths (see bubbleTube.ts).
 *
 * Every tube is rendered whenever its pair is linked and only faded by `visible`,
 * rather than mounted and unmounted, so a tube appears and disappears on the same
 * transition as the bubbles it joins instead of popping a frame ahead of them.
 */
export default function BubbleTubes({ polys, bubbles, isVisible }: BubbleTubesProps) {
  const tubes = linkedPairs(bubbles).reduce<Tube[]>((acc, [i, j]) => {
    // Both ends sit on the same panel — linkedPairs drops any pair that doesn't —
    // so one poly decides whether the tube can be placed at all.
    const poly = polys[bubbles[i].panel]
    if (!poly) return acc
    const geo = tubeBetween(
      bubbleRect(poly.bounds, bubbles[i]),
      bubbleRect(poly.bounds, bubbles[j]),
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
