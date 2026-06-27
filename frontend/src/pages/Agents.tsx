import { useAgents } from '../hooks/useAgents'
import { useSkin } from '../skins/context'

export default function Agents() {
  const data = useAgents()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
