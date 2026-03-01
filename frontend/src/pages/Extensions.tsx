import { useExtensions } from '../hooks/useExtensions'
import { useSkin } from '../skins/context'

export default function Extensions() {
  const data = useExtensions()
  const { views } = useSkin()
  return <views.Extensions {...data} />
}
