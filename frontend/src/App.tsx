import { Suspense, useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useSkin } from './skins/context'
import { useAuth } from './hooks/useAuth'
import { useSmsConversations } from './hooks/useSmsConversations'
import type { UseSmsConversationsResult } from './hooks/useSmsConversations'
import { useSmsSimulation } from './hooks/useSmsSimulation'
import { SoftphoneProvider, useSharedSoftphone } from './hooks/softphoneContext'
import { useCallSimulation } from './hooks/useCallSimulation'
import type { UseSoftphoneResult } from './hooks/useSoftphone'
import { detectCallSim } from './lib/callSimulation'
import { detectSmsSim } from './lib/smsSimulation'
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
        // A loading screen is a picture, not a document: it wears the skin's own
        // pointer (inherited by everything on it) and its legend does not highlight.
        cursor: cfg.cursor,
        userSelect: 'none',
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

// Whether this load simulates SMS instead of sending it (`?smsSim=1`, dev only).
// Resolved once, at module load, like the comic-book editor's own flag — and the inline
// `import.meta.env.DEV` is what lets a production build fold the test to `false` and
// tree-shake the simulation branch, and the hook behind it, out of the bundle.
const SMS_SIM = import.meta.env.DEV && detectSmsSim()

// Same again for the telephone (`?callSim=1`): a call the layout draws as a scene, with
// nobody at the far end and no minutes billed.
const CALL_SIM = import.meta.env.DEV && detectCallSim()

// The two SMS sources are two components rather than one conditional hook call: the
// rules of hooks forbid the conditional even on a constant, and each component's hook
// list stays fixed for its life this way.
function AuthenticatedApp() {
  return SMS_SIM ? <SimulatedSmsApp /> : <LiveSmsApp />
}

function LiveSmsApp() {
  // Skin chrome cannot fetch, and a bubble chain lives in the Layout rather than in a
  // view, so its data has to arrive as a Layout prop. Idle until a skin subscribes.
  return <CallSource sms={useSmsConversations()} />
}

function SimulatedSmsApp() {
  return <CallSource sms={useSmsSimulation()} />
}

// The telephone, split the same way and for the same reason. The simulated one is the
// layout's alone: the /softphone page keeps the shared live phone, since the scene is
// what the simulation exists to show.
function CallSource({ sms }: { sms: UseSmsConversationsResult }) {
  return CALL_SIM ? <SimulatedCallApp sms={sms} /> : <LiveCallApp sms={sms} />
}

function LiveCallApp({ sms }: { sms: UseSmsConversationsResult }) {
  // The layout gets the phone because a skin may put one *in* the page — the comic-book
  // skin projects a number pad onto a photographed telephone — and a layout-level
  // control has to be the same device as the one the /softphone page drives.
  return <AppShell sms={sms} softphone={useSharedSoftphone()} />
}

function SimulatedCallApp({ sms }: { sms: UseSmsConversationsResult }) {
  return <AppShell sms={sms} softphone={useCallSimulation()} />
}

function AppShell({ sms, softphone }: { sms: UseSmsConversationsResult; softphone: UseSoftphoneResult }) {
  const { Layout } = useSkin()
  return (
    <>
      <Layout navItems={NAV_ITEMS} sms={sms} softphone={softphone}>
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
