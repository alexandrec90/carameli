// The pure half of the SMS simulation: the odds and timing of a simulated reply and the
// pool a reply is drawn from. The hook that owns the timers and state is
// `hooks/useSmsConversations.ts`; everything here is a function of its arguments so the
// 50% coin and the pool draw are testable with a seeded rng.

/** Chance that the peer answers a message at all. A coin flip, per send. */
export const SIM_REPLY_CHANCE = 0.5

/** Pause before the peer "starts typing" — the dots appearing, as though they read it. */
export const SIM_TYPING_DELAY_MS = 900

/** How long the typing dots stay up before the reply lands. */
export const SIM_TYPING_MS = 1800

/** The account's own number, as far as the simulation is concerned. A reserved fiction. */
export const SIM_SENDER = '+15550100'

/** What the simulated peer might say. Flavor only — nothing reads these back. */
export const SIM_REPLIES: readonly string[] = [
  'On my way!',
  'Sounds good to me.',
  'Wait, who is this?',
  'Give me five minutes.',
  'Can you call me instead?',
  'No way. Really?',
  'Perfect, see you then.',
  'Let me check and get back to you.',
  'Sure thing!',
  'That works for me.',
]

/**
 * What the peer does with a message: a reply, or `null` for silence. Two draws from the
 * one rng — the coin first, then the pick — so a test seeds a sequence and knows exactly
 * which reply a given send produces.
 */
export function simReply(rng: () => number): string | null {
  if (rng() >= SIM_REPLY_CHANCE) return null
  const at = Math.min(SIM_REPLIES.length - 1, Math.floor(rng() * SIM_REPLIES.length))
  return SIM_REPLIES[at]
}
