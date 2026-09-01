import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { SkinProvider } from './skins/context'
import { startSession } from './hooks/useAuth'
import { installGlobalErrorHandlers } from './lib/errorReporting'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import '@fontsource/outfit/800.css'
import './index.css'

// Capture uncaught JS errors and unhandled promise rejections into the log file.
installGlobalErrorHandlers()

// Put the session request on the wire before React renders, because nothing below this
// line can. `SkinProvider` withholds its children until the skin's chunk has loaded and
// `App` withholds its own until this request returns, so a fetch issued from inside the
// tree waits out the entire skin first — two independent delays taken one after the
// other, for a request that never needed the skin. Started here they overlap. See
// `hooks/useAuth.ts`; calling it twice is free, so the hook still owns the state.
startSession()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SkinProvider>
        <App />
      </SkinProvider>
    </BrowserRouter>
  </React.StrictMode>
)
