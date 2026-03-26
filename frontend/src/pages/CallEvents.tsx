import { useSkin } from '../skins/context'

export default function CallEvents() {
  const { views } = useSkin()
  return (
    <views.Placeholder
      title="Call Events"
      description="Real-time call tracking and status history"
    />
  )
}
