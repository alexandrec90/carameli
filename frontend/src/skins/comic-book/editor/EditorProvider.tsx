import type { ReactNode } from 'react'

import { EditorContext } from './editorContext'
import { useEditorEngine } from './useEditorMode'

// The dev-only half of ./editorContext.ts: the module that actually *builds* an editor
// and hands it down. `Layout.tsx` reaches this through a `lazy()` behind
// `import.meta.env.DEV`, so a production build folds the branch away and Rollup drops this
// module and everything it imports — which is the entire engine.
//
// It is a component of its own rather than a few lines inside Layout because the engine is
// a hook: something has to call it, and that caller has to be a module a production build
// can decline to load. Everything the engine needs comes from the browser and from
// localStorage, so it needs nothing from Layout's render — which is why this can sit above
// Layout while ./EditorOverlay.tsx, which needs panel geometry, cannot.

/** Mounts the editor engine and publishes it to the page below. Dev only. */
export default function EditorProvider({ children }: { children: ReactNode }) {
  const editor = useEditorEngine()
  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>
}
