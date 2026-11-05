import type { CallSpeaker } from './callTranscript'

// The pure half of the call simulation: the timing of a simulated call and the
// conversation it plays. The hook that owns the timers and state is
// `hooks/useSoftphone.ts`; everything here is a function of its arguments, so the pauses
// and the fillers are testable with a seeded rng.

/** The extension the simulated phone claims to be registered as. */
export const SIM_EXTENSION = '101'

/** How long the far end rings before picking up. */
export const SIM_RING_MS = 3200

/** Pause after the pickup before the first word. */
export const SIM_FIRST_LINE_MS = 900

/** A silence between two lines lasts somewhere in this range, drawn per line. */
export const SIM_GAP_MIN_MS = 600
export const SIM_GAP_MAX_MS = 2400

/** How long a line is "being said": its speaker stays lit for this long. */
export const SIM_MS_PER_CHAR = 55
export const SIM_SPEAK_MIN_MS = 800

/** The call goes quiet after this many lines; the transcript has shown what it can. */
export const SIM_MAX_LINES = 40

export interface SimLine {
  speaker: CallSpeaker
  text: string
}

/** The conversation, in order. The caller (`local`) has questions; the far end has answers. */
export const SIM_SCRIPT: readonly SimLine[] = [
  { speaker: 'remote', text: 'Hello?' },
  { speaker: 'local', text: 'Where are you? You said you would be home by seven.' },
  { speaker: 'remote', text: 'I am... still at the office. Big deadline.' },
  { speaker: 'local', text: 'The office. On a Saturday.' },
  { speaker: 'remote', text: 'Yes? The, uh, Saturday deadline.' },
  { speaker: 'local', text: 'I can hear a saxophone.' },
  { speaker: 'remote', text: 'That is the printer. New printer.' },
  { speaker: 'local', text: 'And whose laughter is that?' },
  { speaker: 'remote', text: 'The printer laughs now too. Very modern printer.' },
  { speaker: 'local', text: 'Come home. Now.' },
  { speaker: 'remote', text: 'Right away, dear. Five minutes.' },
]

/** Once the script runs out, either party may say one of these, at random. */
export const SIM_FILLERS: Readonly<Record<CallSpeaker, readonly string[]>> = {
  local: ['Mm-hm.', 'Go on.', 'I am listening.', 'Really.', 'Are you still there?'],
  remote: [
    'It is not what it sounds like.',
    'I can explain.',
    'Hello? You there?',
    'Let me call you back.',
    'The traffic, you would not believe it.',
  ],
}

/** A silence, drawn from the range: `rng` at 0 is the shortest, just under 1 the longest. */
export function simGapMs(rng: () => number): number {
  return Math.floor(SIM_GAP_MIN_MS + rng() * (SIM_GAP_MAX_MS - SIM_GAP_MIN_MS))
}

/** How long `text` takes to say: a floor, then a rate, so a short line is not a flicker. */
export function speakMs(text: string): number {
  return Math.max(SIM_SPEAK_MIN_MS, text.length * SIM_MS_PER_CHAR)
}

/**
 * Line `index` of the call: the script while it lasts, then fillers — two draws from the
 * rng, the speaker first and the line second — and `null` once the call has said enough.
 */
export function simLineAt(index: number, rng: () => number): SimLine | null {
  if (index >= SIM_MAX_LINES) return null
  if (index < SIM_SCRIPT.length) return SIM_SCRIPT[index]
  const speaker: CallSpeaker = rng() < 0.5 ? 'local' : 'remote'
  const pool = SIM_FILLERS[speaker]
  const at = Math.min(pool.length - 1, Math.floor(rng() * pool.length))
  return { speaker, text: pool[at] }
}
