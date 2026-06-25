import { useSms } from '../hooks/useSms'
import { useSkin } from '../skins/context'

export default function Sms() {
  const data = useSms()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
