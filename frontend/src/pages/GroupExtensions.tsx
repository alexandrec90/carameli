import { useGroupExtensions } from '../hooks/useGroupExtensions'
import { useSkin } from '../skins/context'

export default function GroupExtensions() {
  const data = useGroupExtensions()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
