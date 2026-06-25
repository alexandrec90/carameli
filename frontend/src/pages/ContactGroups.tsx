import { useContactGroups } from '../hooks/useContactGroups'
import { useSkin } from '../skins/context'

export default function ContactGroups() {
  const data = useContactGroups()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
