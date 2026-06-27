import { useAudioAssets } from '../hooks/useAudioAssets'
import { useSkin } from '../skins/context'

export default function Prompts() {
  const data = useAudioAssets('prompt', 'Prompts', 'IVR and menu prompt recordings')
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
