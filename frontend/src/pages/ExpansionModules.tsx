import { useExpansionModules } from '../hooks/useExpansionModules'
import { useSkin } from '../skins/context'

export default function ExpansionModules() {
  const data = useExpansionModules()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
