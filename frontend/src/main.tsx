import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { logger } from './lib/logger'
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
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
