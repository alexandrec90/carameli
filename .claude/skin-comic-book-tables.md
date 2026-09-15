# Projected table surfaces in the Comic Book skin

The mechanism behind the *projected table surface* section of
[`rules/skin-comic-book.md`](rules/skin-comic-book.md) — the projection, the band
arithmetic, the row wash and the live feeds. It is a **reference file, not a rule**:
nothing loads it automatically, and the rule carries a pointer to it plus the hard rules
(16, 18, 19, 21) that bind without it.

It lives outside `rules/` deliberately, for the reason
[`engineering-evidence.md`](engineering-evidence.md) gives: every `.md` under
`.claude/rules/` is loaded as a rule, and this is prose that should be paid for only by
someone editing `ProjectedTable.tsx`, `tableProjection.ts`, `tableData.ts` or
`lib/liveTables.ts`.

Any picture may carry an optional `table` drawing an HTML table onto the surface it depicts — a
notepad, a whiteboard, a screen. The field is **absent** on a picture that is not a surface (in
`configSeed.ts`, `configHydrate.ts` and `serializeTable.ts` alike), so `'table' in img` is reliable.

## The projection and the bands

- **The tilt is a projective map, not a rotation.** `tableProjection.ts` takes the four corners
  (`quad`, in % of the picture's *rendered* rect via `surfaceBaseRect`, so a pan, a zoom or a change
  of shape carries the surface with the photograph), solves the homography from the unit square and
  emits one `matrix3d` — `rotateX`/`rotateY`/`perspective` is a three-way search in which each axis
  undoes the last. The table lays out at `quadSourceBox`, the mean of the quad's opposite edges, not
  at the frame: a 3D-transformed element rasterises once at its layout size, so one four times too
  large is downsampled lettering.
- **Rows snap because the offset is an index, not a position.** The surface divides into `rows`
  bands in un-projected space and scrolling advances an integer index into `data`, so band *k* lands
  in the same place at every offset. Rows outside the window are never rendered, which is why there
  is no scrollbar to hide. `wheelRows` carries sub-row remainder so a trackpad's small deltas still
  move a row; two off-screen buttons and an `aria-live` count are the keyboard's.
- **A band is a budget.** A CSS row height is a *minimum*, so content taller than its band grows the
  row and walks every row below it off its line. `BAND_SIT` (lettering's gap above its rule) in
  `tableData.ts` is a fraction of the band, resolved into a custom property by `ProjectedTable.tsx`
  for `table.css` to spend; `FONT_SCALE.max + BAND_SIT <= 1` is the invariant (`tableData.test.ts`).
  **A cell holds lettering and nothing else** — artwork at the few pixels a band is came out as
  smudges, so the call log's status is a word (`CALL_STATUS_LABELS`). `.cb-ptable-clip` is the
  backstop — `hidden` over a window nothing scrolls past, not a scroll container (hard rule 18 in the rule file).
- **A row under the pointer takes one flat wash of the authored ink and nothing else** —
  `TableRowBand.tsx`, placed by band arithmetic onto the row's own ruled line; the number pad's glow
  would blur the ruling and the lettering. **No keyframes, `box-shadow` or pressed state**
  (`ProjectedTable.test.tsx`), and **no z-index**, so deeper pictures cover both wash and rows. Only
  rows backed by records wash; `visibleRows` padding stays blank.
- **The quad is what puts the rows on the drawn lines**: the bottom edge belongs *on* the last ruled
  line and the top edge one band above the first (`notepadRuling.test.ts` holds the shipped
  notepad's to `hand-notepad.webp`; a new picture moves those constants in the same commit).
  **Measure, don't drag**: a drawn ruling is not evenly spaced and no four corners put equal bands
  on it, so *Fit to ruled lines* (`editor/ruledLines.ts`, pure; `editor/fitRuledLines.ts` the canvas
  edge) reads the rules off the picture, sets the corners and `rows`, and records `table.lines`,
  each band's foot as a fraction of the surface pulled back through the quad's inverse homography.
  `bandBounds` (`tableData.ts`) is the one list cells and wash are placed from; `lines` is absent
  for equal bands, dropped by `withRows` when `rows` is retyped, ignored when its length does not
  match. **The surface does not draw the ruling** — the lines stopping at the writing area are the
  editor's band guides, drawn through the same projection as the rows.

## A surface can show live records instead of authored cells

`table.source` names a feed — `'calls'` or `'sms'`, from `TABLE_SOURCES` in `lib/liveTables.ts` —
and is **absent** on an authored surface. The skin names a feed and is handed rows:
`hooks/useLiveTables.ts` is the only module in the chain that touches the API and
`lib/liveTables.ts` owns the columns and record-to-row mapping, so no customer id or endpoint
appears under `skins/`. Rows are injected in `Layout.tsx` between the editor's working copy and the
panels (`useLiveTableImages`), so every component below stays renderable from a plain config in a
test and the editor keeps holding the authored surface.

- **`data` stays empty for a live surface — a privacy invariant, not tidiness.** The feed is call
  and message history, so saved rows would put real phone numbers into `layoutConfig.ts`. Enforced
  three times: the injection is downstream of the editor's config, `coerceTable` empties `data`
  when a source is set, and the inspector's feed switch replaces the cells.
- **A live surface's columns are the feed's**, because the mapper emits cells positionally; widths,
  alignment and headings stay the author's, but the editor hides **+ Column** / **−**, and
  `feedColumns` (`editor/tableValidate.ts`) replaces any list that is not the feed's length on the
  way out — for one reason, a tab older than the feed's shape.
- **Live means polling** — `useLiveTables` re-asks every `LIVE_TABLE_POLL_MS`, skips a hidden tab
  and refreshes on `visibilitychange`, returning the *identical* row array when nothing changed so
  a quiet poll repaints no canvas; a failed refresh keeps the rows on screen. `?sim=1` frames a
  surface against a full table instead (`lib/simTables.ts`, dev-only, `localStorage['live-tables:sim']`),
  built through the feed's own mapper so no cell drifts out from under its heading.
