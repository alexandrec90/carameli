import { Routes, Route } from 'react-router-dom'
import { useSkin } from './skins/context'
import { SkinSwitcher } from './components/SkinSwitcher'
import { useAuth } from './hooks/useAuth'
import Dashboard from './pages/Dashboard'
import PhoneLines from './pages/PhoneLines'
import Extensions from './pages/Extensions'
import Placeholder from './pages/Placeholder'

export default function App() {
  const { ready } = useAuth()

  if (!ready) return null

  return <AuthenticatedApp />
}

function AuthenticatedApp() {
  const { Layout } = useSkin()
  return (
    <>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/phone-lines" element={<PhoneLines />} />
          <Route path="/extensions" element={<Extensions />} />
          <Route
            path="/sms"
            element={
              <Placeholder
                title="SMS"
                description="Enable, disable, and send SMS messages via the active carrier"
              />
            }
          />
          <Route
            path="/calls"
            element={
              <Placeholder
                title="Call Events"
                description="Real-time call tracking and status history"
              />
            }
          />
          <Route
            path="/settings"
            element={
              <Placeholder
                title="Settings"
                description="Configure Carameli runtime and provider settings"
              />
            }
          />
        </Routes>
      </Layout>
      <SkinSwitcher />
    </>
  )
}
