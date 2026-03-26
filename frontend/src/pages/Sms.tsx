import { useSkin } from '../skins/context'

export default function Sms() {
  const { views } = useSkin()
  return (
    <views.Placeholder
      title="SMS"
      description="Enable, disable, and send SMS messages via the active carrier"
    />
  )
}
