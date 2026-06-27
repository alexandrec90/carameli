import { useAudioAssets } from '../hooks/useAudioAssets'
import { useSkin } from '../skins/context'

export default function CustomOnHold() {
  const data = useAudioAssets('hold', 'Custom On Hold', 'Audio played to callers placed on hold')
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
