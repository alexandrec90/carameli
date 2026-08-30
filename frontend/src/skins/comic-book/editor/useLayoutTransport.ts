import { useState } from 'react'

import { logger } from '../../../lib/logger'
import { serializeConfig, serializeConfigFile } from './serialize'
import type { EditorConfig } from './types'

// The four ways a working copy leaves the browser — write the file, carry it to a PR,
// copy it, download it — with the state each one needs to say what happened. Split out of
// EditorToolbar.tsx, which was holding three promise chains and the markup around them:
// none of this is about how the toolbar looks, and all of it is about what a press does.

/** Dev-only endpoint (Vite middleware) that overwrites editor/layoutConfig.ts. */
const SAVE_ENDPOINT = '/__comic-editor/save'

/**
 * Dev-only endpoint that saves *and* then branches, commits, pushes and opens or
 * updates a PR. Save alone writes into whichever tree the dev server is serving, and
 * two of the three that run this editor — a detached `.ui-previews/` copy, the static
 * checkout — hold that file somewhere git is not watching and a cleanup can delete.
 * See `frontend/shipLayout.ts` for the whole of that reasoning.
 */
const SHIP_ENDPOINT = '/__comic-editor/ship'

/** What the ship endpoint answers with; mirrors ShipOutcome in frontend/shipLayout.ts. */
interface ShipResponse {
  ok: boolean
  message: string
  branch?: string
  prUrl?: string
}

export type ShipState =
  | { phase: 'idle' }
  | { phase: 'busy' }
  | { phase: 'done'; message: string; prUrl?: string }
  | { phase: 'error'; message: string }

/**
 * Save's outcome, as a state rather than a boolean, because the failure has to be
 * *visible*. A save that cannot write the file falls back to downloading it, and while
 * that fallback was announced only in the log the button said "Save" again a moment
 * later — indistinguishable from a save that worked. That is how a broken write target
 * went unnoticed: every press downloaded a copy of `layoutConfig.ts` and the editor's
 * work never reached the app outside edit mode.
 *
 * `confirm` is the second of those states that is not about success: the working copy
 * predates the file, and the press has been turned into a question.
 */
export type SaveState =
  | { phase: 'idle' }
  | { phase: 'confirm' }
  | { phase: 'done' }
  | { phase: 'error'; message: string }

export interface LayoutTransport {
  save: SaveState
  ship: ShipState
  copied: boolean
  summary: string
  setSummary(summary: string): void
  /** Write the working copy over `layoutConfig.ts` — asking first when it is stale. */
  onSave(): void
  /** Save, branch, push, and open or update the PR. */
  onShip(): void
  /** Put the config on the clipboard, falling back to a download. */
  onCopyConfig(): void
  /** Hand the whole file to the browser as a download. */
  onDownload(): void
}

/** Fallback when the save endpoint/clipboard is unavailable: download the file. */
function downloadConfig(text: string): void {
  const blob = new Blob([text], { type: 'text/typescript' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'layoutConfig.ts'
  a.click()
  URL.revokeObjectURL(url)
}

/** The message an unknown rejection carries, for the status line and the log alike. */
function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** POST a JSON body to one of the two dev-only middlewares. */
function post(endpoint: string, body: unknown): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Ship: save, branch, push, PR — with whatever the server says about it. */
function shipConfig(
  config: EditorConfig,
  summary: string,
  setShip: (state: ShipState) => void,
): void {
  setShip({ phase: 'busy' })
  post(SHIP_ENDPOINT, { content: serializeConfigFile(config), summary })
    .then(res => res.json().then((body: ShipResponse) => ({ res, body })))
    .then(({ res, body }) => {
      if (!res.ok || !body.ok) throw new Error(body?.message ?? `HTTP ${res.status}`)
      setShip({ phase: 'done', message: body.message, prUrl: body.prUrl })
      logger.info('Comic-book editor: layout shipped', { message: body.message })
    })
    .catch((err: unknown) => {
      setShip({ phase: 'error', message: reason(err) })
      logger.error('Comic-book editor: ship failed', { err: reason(err) })
    })
}

/** Write the working copy over `layoutConfig.ts`, downloading it if that cannot be done. */
function writeConfig(
  content: string,
  unfinished: number,
  setSave: (state: SaveState) => void,
): void {
  post(SAVE_ENDPOINT, { content })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSave({ phase: 'done' })
      // The count goes in the log because it is the record of what the *file* now holds:
      // the author sees the list in the toolbar, but whoever finds this tree afterwards
      // sees only the file.
      logger.info('Comic-book editor: config saved to layoutConfig.ts', { unfinished })
      window.setTimeout(() => setSave({ phase: 'idle' }), 1500)
    })
    .catch((err: unknown) => {
      logger.error('Comic-book editor: save failed, downloading instead', { err: reason(err) })
      // The download stays — it is the only copy of the work when the endpoint is gone —
      // but it is now announced, so it cannot read as a save that worked.
      setSave({ phase: 'error', message: reason(err) })
      downloadConfig(content)
    })
}

/** Clipboard, or a download when there is no clipboard to write to. */
function copyConfig(config: EditorConfig, setCopied: (copied: boolean) => void): void {
  if (!navigator.clipboard?.writeText) {
    downloadConfig(serializeConfigFile(config))
    return
  }
  navigator.clipboard
    .writeText(serializeConfig(config))
    .then(() => {
      setCopied(true)
      logger.info('Comic-book editor: config copied to clipboard')
      window.setTimeout(() => setCopied(false), 1500)
    })
    .catch((err: unknown) => {
      logger.error('Comic-book editor: clipboard write failed, downloading instead', {
        err: reason(err),
      })
      downloadConfig(serializeConfigFile(config))
    })
}

/**
 * Everything the toolbar's outbound buttons do. `stale` turns the first Save press into a
 * question (see ./configStamp.ts) and `unfinished` is logged with a successful write,
 * because the author sees the list of unfinished balloons in the toolbar and whoever finds
 * the tree afterwards sees only the file.
 */
export function useLayoutTransport(
  config: EditorConfig,
  stale: boolean,
  unfinished: number,
): LayoutTransport {
  const [copied, setCopied] = useState(false)
  const [save, setSave] = useState<SaveState>({ phase: 'idle' })
  const [summary, setSummary] = useState('')
  const [ship, setShip] = useState<ShipState>({ phase: 'idle' })

  const onSave = () => {
    // A working copy that predates the file on disk overwrites work nobody chose to
    // revert, and the author is the only one who can tell a deliberate rollback from a tab
    // left open across a merge. So the first press asks and the second writes — one extra
    // click, and only in the case where the file has actually moved.
    if (stale && save.phase !== 'confirm') setSave({ phase: 'confirm' })
    else writeConfig(serializeConfigFile(config), unfinished, setSave)
  }

  return {
    save,
    ship,
    copied,
    summary,
    setSummary,
    onSave,
    onShip: () => shipConfig(config, summary, setShip),
    onCopyConfig: () => copyConfig(config, setCopied),
    onDownload: () => downloadConfig(serializeConfigFile(config)),
  }
}
