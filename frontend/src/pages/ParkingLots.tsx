import { useParkingLots } from '../hooks/useParkingLots'
import { useSkin } from '../skins/context'

export default function ParkingLots() {
  const data = useParkingLots()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
