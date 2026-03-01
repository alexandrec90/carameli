import { usePhoneLines } from '../hooks/usePhoneLines'
import { useSkin } from '../skins/context'

export default function PhoneLines() {
  const data = usePhoneLines()
  const { views } = useSkin()
  return <views.PhoneLines {...data} />
}
