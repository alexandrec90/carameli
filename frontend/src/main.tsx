import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { SkinProvider } from './skins/context'
import { installGlobalErrorHandlers } from './lib/errorReporting'
import { auditArtPreload } from './lib/artPreload'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import '@fontsource/outfit/800.css'
import './index.css'

// Capture uncaught JS errors and unhandled promise rejections into the log file.
installGlobalErrorHandlers()

// Report panel art that index.html fetched and this page turned out not to draw.
auditArtPreload()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SkinProvider>
        <App />
      </SkinProvider>
    </BrowserRouter>
  </React.StrictMode>
)
