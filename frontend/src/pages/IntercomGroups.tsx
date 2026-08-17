import { useIntercomGroups } from '../hooks/useIntercomGroups'
import { useSkin } from '../skins/context'

export default function IntercomGroups() {
  const data = useIntercomGroups()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
