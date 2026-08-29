// The pictures a panel image can point at. A static manifest rather than a directory
// listing: the files are served straight out of `frontend/public/comic-book/`, and the
// browser has no way to enumerate that, so the editor's picture dropdown needs the list
// written down. Adding artwork means dropping the file in and adding a line here.

/** One selectable picture, by public URL. */
export interface PanelAsset {
  /** Public URL, percent-encoded — some filenames contain a space. */
  src: string
  /** Name shown in the editor's picture dropdown. */
  label: string
}

export const PANEL_ASSETS: PanelAsset[] = [
  { src: '/comic-book/logo.webp', label: 'Carameli logo' },
  { src: '/comic-book/switchboard.webp', label: 'Switchboard' },
  { src: '/comic-book/mailman1.webp', label: 'Mail carrier' },
  { src: '/comic-book/mechanic.webp', label: 'Mechanic' },
  { src: '/comic-book/receptionist.webp', label: 'Receptionist' },
  { src: '/comic-book/rolodex.webp', label: 'Rolodex' },
  { src: '/comic-book/rotary%20phone.webp', label: 'Rotary phone' },
  { src: '/comic-book/mailman2.webp', label: 'Post office' },
  { src: '/comic-book/logo2.webp', label: 'Carameli logo 2' },
  { src: '/comic-book/push-button-phone.webp', label: 'Push-button phone' },
  { src: '/comic-book/conversation.webp', label: 'Two agents talking' },
  { src: '/comic-book/hand-notepad.webp', label: 'Hand with notepad' },
  { src: '/comic-book/call-button.webp', label: 'Call button' },
  { src: '/comic-book/cloud%20bubble.webp', label: 'Cloud bubble' },
  { src: '/comic-book/end-call-button.webp', label: 'End call button' },
  { src: '/comic-book/jagged%20bubble.webp', label: 'Jagged bubble' },
  { src: '/comic-book/lightning%20bubble.webp', label: 'Lightning bubble' },
  { src: '/comic-book/monogram.webp', label: 'Monogram' },
  { src: '/comic-book/soft%20bubble.webp', label: 'Soft bubble' },
  { src: '/comic-book/call-ended.webp', label: 'Call ended' },
  { src: '/comic-book/call-failed.webp', label: 'Call failed' },
  { src: '/comic-book/call-in-progress.webp', label: 'Call in progress' },
  { src: '/comic-book/pensive-woman.webp', label: 'Pensive woman' },
  { src: '/comic-book/caret.webp', label: 'Caret' },
  { src: '/comic-book/click.webp', label: 'Click' },
  { src: '/comic-book/pointer.webp', label: 'Pointer' },
  { src: '/comic-book/wait.webp', label: 'Wait' },
  { src: '/comic-book/cheating-man.webp', label: 'Cheating man' },
  { src: '/comic-book/despondent-wife.webp', label: 'Despondent wife' },
  { src: '/comic-book/ringing-phone.webp', label: 'Ringing phone' },
  { src: '/comic-book/move-cursor.webp', label: 'Move cursor' },
]

/**
 * Label for `src`, falling back to the URL itself. A config may name a file that is not
 * in the manifest — hand-edited, or added to `public/` without a line here — and the
 * dropdown has to keep showing it rather than silently re-pointing the image at
 * whatever happens to be first in the list.
 */
export function assetLabel(src: string): string {
  return PANEL_ASSETS.find(a => a.src === src)?.label ?? src
}
