import { useCallEvents } from '../hooks/useCallEvents'
import { useSkin } from '../skins/context'

export default function CallEvents() {
  const data = useCallEvents()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
