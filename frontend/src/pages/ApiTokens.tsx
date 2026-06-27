import { useApiToken } from '../hooks/useApiToken'
import { useSkin } from '../skins/context'

export default function ApiTokens() {
  const data = useApiToken()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
