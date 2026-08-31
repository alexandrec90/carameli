import type { Rect } from '../panelGeometry'
import { rectStyle } from './overlayGeometry'
import type { Selection } from './selection'
import type { OverlayInteraction } from './useOverlayInteraction'

interface SelectionOutlineProps {
  /** What is selected, or null. */
  selected: Selection | null
  /** The box the outline traces, or null when nothing drawn is selected. */
  rect: Rect | null
  /** True in shapes mode, where a drawn selection has no handles. */
  shapeMode: boolean
  interaction: OverlayInteraction
}

/**
 * The selection outline. A picture or a bubble gets a draggable body plus handles; a
 * selected *panel* is only ever outlined, because a panel is a slot in the grid and there
 * is nothing about it to drag — in either mode.
 */
export default function SelectionOutline({
  selected, rect, shapeMode, interaction,
}: SelectionOutlineProps) {
  if (!rect || !selected) return null
  if (selected.kind === 'panel') {
    return <div className="cb-ed-outline cb-ed-outline-panel" style={rectStyle(rect)} aria-hidden="true" />
  }
  if (shapeMode) return null

  return (
    <div
      className="cb-ed-outline"
      style={rectStyle(rect)}
      aria-hidden="true"
      onPointerDown={e => interaction.beginDrag(e, 'move')}
      onPointerMove={interaction.onPointerMove}
      onPointerUp={interaction.onPointerUp}
      onWheel={interaction.onWheel}
    >
      <div
        className="cb-ed-handle cb-ed-handle-br"
        title={selected.kind === 'img' ? 'Drag to resize the frame' : 'Drag to resize'}
        onPointerDown={e => interaction.beginDrag(e, 'resize')}
        onPointerMove={interaction.onPointerMove}
        onPointerUp={interaction.onPointerUp}
      />
      {/* A picture has two framings, so it needs two grips: the body moves the
          frame across the panel, this one slides the picture behind it. Dragging
          the body used to do the second thing, which is the whole complaint. */}
      {selected.kind === 'img' && (
        <div
          className="cb-ed-handle cb-ed-handle-pan"
          title="Drag to pan the picture inside its frame"
          onPointerDown={e => interaction.beginDrag(e, 'pan')}
          onPointerMove={interaction.onPointerMove}
          onPointerUp={interaction.onPointerUp}
        />
      )}
      {selected.kind === 'bubble' && (
        <div
          className="cb-ed-handle cb-ed-handle-rot"
          title="Drag to rotate"
          onPointerDown={e => interaction.beginDrag(e, 'rotate')}
          onPointerMove={interaction.onPointerMove}
          onPointerUp={interaction.onPointerUp}
        />
      )}
    </div>
  )
}
