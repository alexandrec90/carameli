import { useUsers } from '../hooks/useUsers'
import { useSkin } from '../skins/context'

export default function Users() {
  const data = useUsers()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
