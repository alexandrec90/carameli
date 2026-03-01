import { useDashboard } from '../hooks/useDashboard'
import { useSkin } from '../skins/context'

export default function Dashboard() {
  const data = useDashboard()
  const { views } = useSkin()
  return <views.Dashboard {...data} />
}
