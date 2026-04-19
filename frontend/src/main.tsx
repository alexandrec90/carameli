import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { SkinProvider } from './skins/context'
import { logger } from './lib/logger'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import '@fontsource/outfit/800.css'
import './index.css'

// Capture uncaught JS errors and unhandled promise rejections into the log file
window.addEventListener('error', (event) => {
  logger.error('Uncaught error', {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    col: event.colno,
  })
})
window.addEventListener('unhandledrejection', (event) => {
  logger.error('Unhandled promise rejection', { reason: String(event.reason) })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true }}>
      <SkinProvider>
        <App />
      </SkinProvider>
    </BrowserRouter>
  </React.StrictMode>
)
