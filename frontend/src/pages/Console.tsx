import { useSkin } from '../skins/context'

export default function Console() {
  const { views } = useSkin()
  return (
    <views.Placeholder
      title="Console"
      description="Extension console settings — requires an active extension assignment."
    />
  )
}
