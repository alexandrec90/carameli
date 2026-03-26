import { Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useSkin } from './skins/context'
import { SkinSwitcher } from './components/SkinSwitcher'
import { useAuth } from './hooks/useAuth'
import { ROUTES, NAV_ITEMS } from './routes'

export default function App() {
  const { ready } = useAuth()

  if (!ready) return null

  return <AuthenticatedApp />
}

function AuthenticatedApp() {
  const { Layout } = useSkin()
  return (
    <>
      <Layout navItems={NAV_ITEMS}>
        <Suspense>
          <Routes>
            {ROUTES.map(({ path, element: Element }) => (
              <Route key={path} path={path} element={<Element />} />
            ))}
          </Routes>
        </Suspense>
      </Layout>
      <SkinSwitcher />
    </>
  )
}
