import { Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useSkin } from './skins/context'
import { useSmsConversations } from './hooks/useSmsConversations'
import { SoftphoneProvider, useSharedSoftphone } from './hooks/softphoneContext'
import { ROUTES, NAV_ITEMS } from './routes'
import { SessionGate } from './SessionGate'

export default function App() {
  const app = (
    <SoftphoneProvider>
      <AppShell />
    </SoftphoneProvider>
  )
  // The demo has no session to wait for, so it draws straight away.
  return import.meta.env.VITE_LIVE_BACKEND === 'true' ? <SessionGate>{app}</SessionGate> : app
}

function AppShell() {
  const { Layout } = useSkin()
  // Skin chrome cannot fetch, and a bubble chain lives in the Layout rather than in a
  // view, so its data has to arrive as a Layout prop.
  const sms = useSmsConversations()
  // The layout gets the phone because a skin may put one *in* the page — the comic-book
  // skin projects a number pad onto a photographed telephone — and a layout-level
  // control has to be the same device as the one the /softphone page drives.
  const softphone = useSharedSoftphone()
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
