import { Suspense, useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useSkin } from './skins/context'
import { useAuth } from './hooks/useAuth'
import { SoftphoneProvider, useSharedSoftphone } from './hooks/softphoneContext'
import { ROUTES, NAV_ITEMS } from './routes'
import { skinLoadingConfigs, resolveSkinName, DEFAULT_SKIN } from './skins/registry'

// 0 on first visit (nothing cached — will be slow), 400 on return visits (likely cached).
const LOADER_DELAY = localStorage.getItem('app:loaded') ? 400 : 0

export default function App() {
  const { ready } = useAuth()
  const [showLoader, setShowLoader] = useState(false)

  useEffect(() => {
    if (ready) { localStorage.setItem('app:loaded', '1'); return }
    const t = setTimeout(() => setShowLoader(true), LOADER_DELAY)
    return () => clearTimeout(t)
  }, [ready])

  if (!ready) {
    const skinName = resolveSkinName(localStorage.getItem('skin') ?? DEFAULT_SKIN)
    const cfg = skinLoadingConfigs[skinName]
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh',
        background: cfg.background,
        backgroundImage: cfg.backgroundImage,
        backgroundSize: cfg.backgroundSize,
      }}>
        {showLoader && (cfg.card ? (
          <div style={{
            border: cfg.card.border, boxShadow: cfg.card.boxShadow,
            background: cfg.card.background, padding: cfg.card.padding,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <span style={cfg.textStyle}>{cfg.text}</span>
          </div>
        ) : (
          <span style={cfg.textStyle}>{cfg.text}</span>
        ))}
      </div>
    )
  }

  return (
    <SoftphoneProvider>
      <AuthenticatedApp />
    </SoftphoneProvider>
  )
}

function AuthenticatedApp() {
  const { Layout } = useSkin()
  // The layout gets the phone because a skin may put one *in* the page — the comic-book
  // skin projects a number pad onto a photographed telephone — and a layout-level
  // control has to be the same device as the one the /softphone page drives.
  const softphone = useSharedSoftphone()
  return (
    <>
      <Layout navItems={NAV_ITEMS} softphone={softphone}>
        <Suspense>
          <Routes>
            {ROUTES.map(({ path, element: Element }) => (
              <Route key={path} path={path} element={<Element />} />
            ))}
          </Routes>
        </Suspense>
      </Layout>
    </>
  )
}
