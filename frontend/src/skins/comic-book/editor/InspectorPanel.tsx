import { CALL_ROLE_LABELS, CALL_ROLES, callSceneOn, isCallRole } from '../callSceneRoles'
import { PATTERN_STYLES, PATTERN_STYLE_KEYS } from '../panelPatterns'
import type { PanelBgStyle } from '../panelPatterns'
import { assetLabel } from './assets'
import BubbleInspector from './BubbleInspector'
import ChainInspector from './ChainInspector'
import ImageInspector from './ImageInspector'
import { CALL_CUT, indicesOnPanel } from './configOps'
import type { CallRole } from './types'
import type { EditorModeApi } from './useEditorMode'

interface InspectorPanelProps {
  api: EditorModeApi
  /** Index of the panel the selection sits on, into the config's panel list. */
  panel: number
}

/** Trim drag-produced floats to 2 decimals for the read-out (drops trailing zeros). */
function fmt(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Selection inspector: live numeric read-outs plus editable controls for the currently
 * selected panel, picture or bubble, and a per-element reset. The kind-specific
 * controls live in ImageInspector and BubbleInspector. Rendered inside the toolbar by
 * EditorOverlay only when something is selected.
 */
export default function InspectorPanel({ api, panel }: InspectorPanelProps) {
  const { selected, config } = api
  if (!selected) return null

  const panelName = config.panels[panel]?.label ?? `Panel ${panel}`
  const selImg = selected.kind === 'img' ? config.images[selected.index] : null
  const selBubble = selected.kind === 'bubble' ? config.bubbles[selected.index] : null
  const panelNameField = (
    <label className="cb-ed-field">
      <span>panel name</span>
      <input
        type="text"
        value={config.panels[panel]?.label ?? ''}
        onChange={e => api.setPanelLabel(panel, e.target.value)}
      />
    </label>
  )

  // A selected panel is a slot, not a drawn thing: it has no transform to read out and
  // nothing to reset — but the slot does own two editable attributes, its name and its
  // Ben-Day background pattern. It also exists so "+ Image" / "+ Bubble" have somewhere
  // to add, and (in shapes mode) so a panel can be cut in two.
  if (selected.kind === 'panel') {
    const imgs = indicesOnPanel(config.images, panel).length
    const bubbles = indicesOnPanel(config.bubbles, panel).length
    // The seam, on a panel that is a phone call. It belongs to the panel and not to any
    // one entry: both halves are measured from it, so moving it from a picture's inspector
    // would be editing every other entry's frame from inside one of them.
    const scene = callSceneOn(config.callScenes, panel)
    return (
      <>
        <div className="cb-ed-label">{panelName} panel</div>
        {panelNameField}
        <label className="cb-ed-field">
          <span>pattern</span>
          <select
            className="cb-ed-select"
            value={config.patterns[panel] ?? PATTERN_STYLE_KEYS[0]}
            onChange={e => api.setPattern(panel, e.target.value as PanelBgStyle)}
          >
            {PATTERN_STYLE_KEYS.map(key => (
              <option key={key} value={key}>{PATTERN_STYLES[key].label}</option>
            ))}
          </select>
        </label>
        {scene && (
          <>
            <label className="cb-ed-field">
              <span>call seam</span>
              <input
                type="range"
                min={CALL_CUT.min}
                max={CALL_CUT.max}
                step={CALL_CUT.step}
                value={scene.cut}
                onChange={e => api.setCallScene(panel, { cut: Number(e.target.value) })}
              />
              <output>{scene.cut}%</output>
            </label>
            <label className="cb-ed-field">
              <span>call split</span>
              <select
                className="cb-ed-select"
                value={scene.axis}
                onChange={e => api.setCallScene(panel, { axis: e.target.value === 'y' ? 'y' : 'x' })}
              >
                <option value="x">Side by side</option>
                <option value="y">One above the other</option>
              </select>
            </label>
          </>
        )}
        <div className="cb-ed-hint">
          {imgs} picture{imgs === 1 ? '' : 's'} · {bubbles} bubble{bubbles === 1 ? '' : 's'}.
          Click one to edit it, or add another below.
        </div>
      </>
    )
  }

  const selEntry = selImg ?? selBubble
  if (!selEntry) return null

  return (
    <>
      <div className="cb-ed-label">
        {selImg ? `${assetLabel(selImg.src)} on ${panelName}` : `${panelName} bubble`}
      </div>
      {panelNameField}

      <dl className="cb-ed-values">
        {selImg && (
          <>
            {/* The frame — the picture's own window over the panel box. */}
            <div><dt>left</dt><dd>{fmt(selImg.left)}%</dd></div>
            <div><dt>top</dt><dd>{fmt(selImg.top)}%</dd></div>
            <div><dt>width</dt><dd>{fmt(selImg.width)}%</dd></div>
            <div><dt>height</dt><dd>{fmt(selImg.height)}%</dd></div>
            {/* The picture's framing inside that window. */}
            <div><dt>scale</dt><dd>{fmt(selImg.scale)}</dd></div>
            <div><dt>offsetX</dt><dd>{fmt(selImg.offsetX)}</dd></div>
            <div><dt>offsetY</dt><dd>{fmt(selImg.offsetY)}</dd></div>
          </>
        )}
        {selBubble && (
          <>
            <div><dt>top</dt><dd>{fmt(selBubble.top)}%</dd></div>
            <div><dt>right</dt><dd>{fmt(selBubble.right)}%</dd></div>
            <div><dt>width</dt><dd>{fmt(selBubble.width)}%</dd></div>
            <div><dt>rotate</dt><dd>{fmt(selBubble.rotate)}°</dd></div>
          </>
        )}
      </dl>

      {/* Which layer of the panel this entry belongs to, and — if it is the call's —
          which half it is framed against. Above the kind-specific fields because it is
          the one that decides when the rest of them are even on screen: an entry with a
          role is invisible on the default layout, and one without is invisible on the
          call. Choosing a role therefore switches the page to the layout the entry has
          just joined, or nothing appears to have happened. */}
      <label className="cb-ed-field">
        <span>call role</span>
        <select
          className="cb-ed-select"
          value={selEntry.call ?? ''}
          onChange={e => {
            const call: CallRole | undefined = isCallRole(e.target.value) ? e.target.value : undefined
            if (selected.kind === 'img') api.setImg(selected.index, { call })
            else api.setBubble(selected.index, { call })
            if (call === undefined) api.setCallPhase(null)
            else if (api.callPhase === null) api.setCallPhase(call === 'ringing' ? 'ringing' : 'connected')
          }}
        >
          <option value="">Not part of a call</option>
          {CALL_ROLES.map(role => (
            <option key={role} value={role}>{CALL_ROLE_LABELS[role]}</option>
          ))}
        </select>
      </label>

      {selImg && <ImageInspector api={api} index={selected.index} image={selImg} />}
      {selBubble && <BubbleInspector api={api} index={selected.index} bubble={selBubble} />}
      {/* The thread this balloon is a slot of, when it is one. Below the balloon's own
          fields because it is a wider scope than the selection: editing it changes every
          balloon in the column, not the one that happens to be selected. */}
      {selBubble?.chain && (
        <ChainInspector api={api} index={selected.index} bubble={selBubble} />
      )}

      {/* Spill toggle — shared by pictures and bubbles */}
      <label className="cb-ed-check">
        <input
          type="checkbox"
          checked={selImg ? selImg.spill : !!selBubble?.spill}
          onChange={e =>
            selected.kind === 'img'
              ? api.setImg(selected.index, { spill: e.target.checked })
              : api.setBubble(selected.index, { spill: e.target.checked })
          }
        />
        <span>Allow spill outside {selImg ? 'frame' : 'panel'}</span>
      </label>

      <div className="cb-ed-actions">
        <button
          type="button"
          className="cb-ed-btn"
          onClick={() => api.resetOne(selected.kind === 'img' ? 'img' : 'bubble', selected.index)}
        >
          Reset
        </button>
        <button
          type="button"
          className="cb-ed-btn cb-ed-btn-danger"
          title={selImg ? 'Delete this picture' : 'Delete this bubble'}
          onClick={() =>
            selImg ? api.deleteImg(selected.index) : api.deleteBubble(selected.index)
          }
        >
          {selImg ? 'Delete image' : 'Delete bubble'}
        </button>
      </div>

      <div className="cb-ed-hint">
        {selImg
          ? 'Drag to move the frame · corner handle resizes it · the round grip pans the picture inside · wheel zooms · arrows nudge (⇧×10, ⌥ pans) · +/− · Del · Esc'
          : 'Drag to move · handle to resize/rotate · arrows nudge (⇧×10) · +/− · Del · Esc'}
      </div>
    </>
  )
}
