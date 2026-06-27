import { useAudioAssets } from '../hooks/useAudioAssets'
import { useSkin } from '../skins/context'

export default function Advertising() {
  const data = useAudioAssets('ad', 'Advertising', 'Advertisement audio clips for on-hold playback')
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
