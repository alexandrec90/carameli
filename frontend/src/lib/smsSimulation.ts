import { logger } from './logger'

// The pure half of the dev-only SMS simulation: the flag that turns it on, the odds and
// timing of a simulated reply, and the pool a reply is drawn from. The hook that owns the
// timers and state is `hooks/useSmsSimulation.ts`; everything here is a function of its
// arguments so the 50% coin and the pool draw are testable with a seeded rng.
//
// Why it exists: a chain bound to real SMS (`sms: true`) sends for real and is billed, so
// there is no way to *look at* the conversation UI — the growth, the columns, the typing
// dots — without spending money and texting somebody. The simulation swaps the data
// source and nothing else: the skin renders the same `UseSmsConversationsResult` shape
// and cannot tell the thread is fake.

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

const FLAG_KEY = 'sms:sim'

/**
 * Resolve the simulation flag for this load, with the same contract as the comic-book
 * editor's `resolveEditFlag` (not imported from there — a lib module cannot reach into a
 * skin): `?smsSim=1` switches it on, `?smsSim=0` off, and either way `storedFlag` is what
 * the persisted flag should become (`null` = removed) so the outcome survives client-side
 * navigation that drops the query. With no usable param, the stored flag decides.
 */
export function resolveSimFlag(
  param: string | null,
  stored: string | null,
): { active: boolean; storedFlag: '1' | null } {
  if (param === '1') return { active: true, storedFlag: '1' }
  if (param === '0') return { active: false, storedFlag: null }
  const active = stored === '1'
  return { active, storedFlag: active ? '1' : null }
}

/**
 * True when this load should simulate SMS instead of sending it. Dev-only twice over:
 * this returns false outside `import.meta.env.DEV`, and the caller in App.tsx repeats
 * that test inline so a production build tree-shakes the simulation out entirely.
 */
export function detectSmsSim(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  const param = new URLSearchParams(window.location.search).get('smsSim')
  try {
    const stored = window.localStorage.getItem(FLAG_KEY)
    const { active, storedFlag } = resolveSimFlag(param, stored)
    if (storedFlag !== stored) {
      if (storedFlag === null) window.localStorage.removeItem(FLAG_KEY)
      else window.localStorage.setItem(FLAG_KEY, storedFlag)
    }
    return active
  } catch (err) {
    logger.warn('Could not persist the SMS simulation flag', { key: FLAG_KEY, err: String(err) })
    return resolveSimFlag(param, null).active
  }
}
