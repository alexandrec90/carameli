import { useWebhooks } from '../hooks/useWebhooks'
import { useSkin } from '../skins/context'

export default function Webhooks() {
  const data = useWebhooks()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
