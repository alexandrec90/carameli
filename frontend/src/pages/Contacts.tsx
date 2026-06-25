import { useContacts } from '../hooks/useContacts'
import { useSkin } from '../skins/context'

export default function Contacts() {
  const data = useContacts()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
