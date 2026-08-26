import { useSharedSoftphone } from '../hooks/softphoneContext'
import { useSkin } from '../skins/context'

export default function Softphone() {
  // The shared instance, not a fresh `useSoftphone()`: a skin may already have a phone
  // on screen, and two hook instances would register the same extension twice.
  const data = useSharedSoftphone()
  const { views } = useSkin()
  return <views.Softphone {...data} />
}
