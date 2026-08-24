import { useSoftphone } from '../hooks/useSoftphone'
import { useSkin } from '../skins/context'

export default function Softphone() {
  const data = useSoftphone()
  const { views } = useSkin()
  return <views.Softphone {...data} />
}
