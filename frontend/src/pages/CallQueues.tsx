import { useCallQueues } from '../hooks/useCallQueues'
import { useSkin } from '../skins/context'

export default function CallQueues() {
  const data = useCallQueues()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
