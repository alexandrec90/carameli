import { useSkin } from '../skins/context'

export default function Settings() {
  const { views } = useSkin()
  return (
    <views.Placeholder
      title="Settings"
      description="Configure Carameli runtime and provider settings"
    />
  )
}
