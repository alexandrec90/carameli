import { useCallSummary } from '../hooks/useCallSummary'
import { useSkin } from '../skins/context'

export default function CallReports() {
  const data = useCallSummary()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
