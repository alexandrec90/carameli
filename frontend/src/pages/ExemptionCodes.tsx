import { useExemptionCodes } from '../hooks/useExemptionCodes'
import { useSkin } from '../skins/context'

export default function ExemptionCodes() {
  const data = useExemptionCodes()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
