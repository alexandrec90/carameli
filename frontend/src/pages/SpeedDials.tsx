import { useSpeedDials } from '../hooks/useSpeedDials'
import { useSkin } from '../skins/context'

export default function SpeedDials() {
  const data = useSpeedDials()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
