import { useSubscriptionLogs } from '../hooks/useSubscriptionLogs'
import { useSkin } from '../skins/context'

export default function SubscriptionLogs() {
  const data = useSubscriptionLogs()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
