import { useConferences } from '../hooks/useConferences'
import { useSkin } from '../skins/context'

export default function Conferences() {
  const data = useConferences()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
