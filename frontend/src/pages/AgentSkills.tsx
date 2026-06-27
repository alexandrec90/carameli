import { useAgentSkills } from '../hooks/useAgentSkills'
import { useSkin } from '../skins/context'

export default function AgentSkills() {
  const data = useAgentSkills()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
