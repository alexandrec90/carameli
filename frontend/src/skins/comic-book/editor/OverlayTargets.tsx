import { halfFor, inRoles } from '../callSceneRoles'
import type { SceneHalves } from '../callSceneGeometry'
import type { PanelPoly, Rect } from '../panelGeometry'
import { assetLabel } from './assets'
import { chainFramesOn } from './chainFrame'
import type { ChainFrame } from './chainFrame'
import { boxOf, rectStyle } from './overlayGeometry'
import type { HalvesOn } from './overlayGeometry'
import { bubbleRect, imgVisibleRect } from './transforms'
import type { BubbleChain, BubbleTransform, CallRole } from './types'
import type { EditorModeApi } from './useEditorMode'

/**
 * Chain frames for one panel, each conversation measured against the box its own balloons
 * are placed in. Three passes rather than one because a call's two halves are two boxes,
 * and a conversation drawn on one of them is % of that half.
 */
function chainFramesFor(
  bubbles: readonly BubbleTransform[],
  chains: readonly BubbleChain[],
  panel: number,
  bounds: Rect,
  halves: SceneHalves | null,
  callRoles: CallRole[] | null,
): ChainFrame[] {
  const shown = bubbles.filter(b => inRoles(b.call, callRoles))
  if (!halves) return chainFramesOn(shown, chains, panel, bounds)
  const inHalf = (half: SceneHalves['a'] | null) =>
    shown.filter(b => halfFor(b.call, halves) === half)
  return [
    ...chainFramesOn(inHalf(halves.a), chains, panel, halves.a.box),
    ...chainFramesOn(inHalf(halves.b), chains, panel, halves.b.box),
    ...chainFramesOn(inHalf(null), chains, panel, bounds),
  ]
}

interface OverlayTargetsProps {
  api: EditorModeApi
  panelPolys: (PanelPoly | null)[]
  natSizes: Record<string, { w: number; h: number }>
  /** Which call roles are on screen, or null for the page's ordinary layout. */
  callRoles: CallRole[] | null
  halvesOn: HalvesOn
  /** True in shapes mode, where only the panel targets are drawn. */
  shapeMode: boolean
}

/**
 * Every transparent click target the overlay lays over the page, plus the chain frames
 * drawn as chrome beside them.
 */
export default function OverlayTargets({
  api, panelPolys, natSizes, callRoles, halvesOn, shapeMode,
}: OverlayTargetsProps) {
  const { config } = api
  return (
    <>
      {/* Per-panel click targets — the backdrop for everything drawn on a panel.
          Selecting a panel is what "+ Image" and "+ Bubble" act on, and it is the only
          way to reach a panel that has nothing on it yet. Rendered in both modes: in
          shapes mode a selected panel is what the split buttons cut, and the targets
          paint *before* the seam layer, so a seam or a corner running across one still
          takes the pointer — only the space between the lines selects the panel. */}
      {panelPolys.map((poly, i) =>
        poly === null ? null : (
          <button
            key={i}
            type="button"
            className="cb-ed-target"
            style={rectStyle(poly.bounds)}
            aria-label={`Select ${config.panels[i]?.label ?? `panel ${i}`}`}
            onClick={() => api.select('panel', i)}
          />
        ),
      )}

      {/* The picture and bubble targets are not merely hidden in shapes mode, they are
          not rendered: a picture-sized click target sitting over a seam would eat every
          drag aimed at the line running through it. */}
      {!shapeMode && (
        <>
          {/* One click target per picture, on the rectangle its pixels visibly occupy —
              the image, not the frame it hangs in. They paint after the panel targets so
              a picture wins the click where the two overlap. */}
          {config.images.map((img, i) => {
            const poly = panelPolys[img.panel]
            if (!poly || !inRoles(img.call, callRoles)) return null
            const box = boxOf(img, poly.bounds, halvesOn(img.panel))
            return (
              <button
                key={i}
                type="button"
                className="cb-ed-target cb-ed-target-img"
                style={rectStyle(imgVisibleRect(box, natSizes[img.src], img))}
                aria-label={`Select ${assetLabel(img.src)} on ${config.panels[img.panel]?.label ?? `panel ${img.panel}`}`}
                onClick={() => api.select('img', i)}
              />
            )
          })}

          {/* One click target per bubble, placed against the panel it belongs to. They
              paint last so a bubble stays clickable where it overlaps a picture, its own
              panel — or a neighbour's, once it spills into the gutter. */}
          {config.bubbles.map((bubble, i) => {
            const poly = panelPolys[bubble.panel]
            if (!poly || !inRoles(bubble.call, callRoles)) return null
            const box = boxOf(bubble, poly.bounds, halvesOn(bubble.panel))
            return (
              <button
                key={i}
                type="button"
                className="cb-ed-target cb-ed-target-bubble"
                style={rectStyle(bubbleRect(box, bubble))}
                aria-label={`Select ${config.panels[bubble.panel]?.label ?? `panel ${bubble.panel}`} bubble ${i}`}
                onClick={() => api.select('bubble', i)}
              />
            )
          })}

          {/* Where each conversation's rows will actually land. Chains render *flat* in
              edit mode so both templates stay selectable, which left the table itself
              drawn nowhere the author could see — so dragging a template or changing
              `rows` were edits with invisible results, and the editor read as disagreeing
              with the page. The frame is chrome, not a control: it takes no pointer, and
              stretching the table is still done by moving the two balloons it is measured
              from. */}
          {panelPolys.map((poly, i) =>
            poly === null
              ? null
              : chainFramesFor(
                config.bubbles, config.chains, i, poly.bounds, halvesOn(i), callRoles,
              ).map((frame, k) => (
                <div
                  // Keyed by position as well as by id: a conversation whose two columns
                  // sit on opposite halves of a call is measured once per half, so the
                  // same id can be two frames.
                  key={`${i}:${k}:${frame.id}`}
                  className="cb-ed-chainbox"
                  style={rectStyle(frame.rect)}
                  aria-hidden="true"
                />
              )),
          )}
        </>
      )}
    </>
  )
}
