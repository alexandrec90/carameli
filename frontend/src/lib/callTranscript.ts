/**
 * The words of a call as the two parties say them, and who is saying something now.
 *
 * `local` is this telephone's side — the person who lifted the receiver here — and
 * `remote` is whoever answered. The distinction is by seat rather than by name because
 * a transcript is drawn as two speech bubbles, one per seat, before either party has
 * been identified; the skin only needs to know which bubble a line goes in.
 *
 * The live softphone hands out {@link EMPTY_TRANSCRIPT} today: nothing transcribes a
 * real call yet, and this type is what a transcription will fill in when it exists.
 * The simulation (`hooks/useCallSimulation.ts`) fills it with a scripted conversation.
 */
export type CallSpeaker = 'local' | 'remote'

export interface CallTranscriptLine {
  /** Unique across the call; a render key, nothing more. */
  id: string
  speaker: CallSpeaker
  text: string
}

export interface CallTranscript {
  /** Oldest first. */
  lines: readonly CallTranscriptLine[]
  /** Whose voice is on the line right now, or null in a silence. */
  speaking: CallSpeaker | null
}

/** One shared instance, so a phone with nothing to say hands out the same object each render. */
export const EMPTY_TRANSCRIPT: CallTranscript = { lines: [], speaking: null }

/** One seat's side of the conversation, in order. */
export function linesBy(
  transcript: CallTranscript,
  speaker: CallSpeaker,
): readonly CallTranscriptLine[] {
  return transcript.lines.filter(line => line.speaker === speaker)
}
