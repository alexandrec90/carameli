import { useMulticastGroups } from '../hooks/useMulticastGroups'
import { useSkin } from '../skins/context'

export default function MulticastGroups() {
  const data = useMulticastGroups()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
