import { syncCallScenes } from './callSceneOps'
import { propagateChains, syncChains } from './chainOps'
import { sanitizeLinks } from './configHydrate'
import type { EditorConfig } from './types'

// One function, in a module of its own, because two op files need it and neither may
// import the other: configOps.ts owns the edits to a config, chainCreate.ts owns the one
// edit that builds a whole conversation, and both have to leave the derived halves settled.

/**
 * Bring the derived halves of a config back into agreement with its bubbles, in the one
 * order they can be derived in: links that no longer make sense are nulled, chain ids are
 * settled from the linkage that survives, and the chain list is recomputed from the ids.
 *
 * Every op that can touch a bubble runs this, which is what keeps "add a chain" and
 * "delete a chain" from needing to exist as operations at all — and what makes linking a
 * loose balloon onto a chained one enough to make it a slot of that chain.
 *
 * Every op that can touch a **picture** runs it too, which the chain half never needed:
 * a panel is a phone call for as long as some entry on it carries a `call` role, and a
 * picture is one of the two kinds that can. Marking one is what turns the panel into a
 * call; deleting the last marked one is what turns it back.
 */
export function reconcile(config: EditorConfig): EditorConfig {
  config.bubbles = propagateChains(sanitizeLinks(config.bubbles))
  config.chains = syncChains(config.bubbles, config.chains)
  config.callScenes = syncCallScenes(config.images, config.bubbles, config.callScenes)
  return config
}
