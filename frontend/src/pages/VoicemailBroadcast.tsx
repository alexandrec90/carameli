import { useAudioAssets } from '../hooks/useAudioAssets'
import { useSkin } from '../skins/context'

export default function VoicemailBroadcast() {
  const data = useAudioAssets(
    'broadcast',
    'Voicemail Broadcast',
    'Audio files used for broadcast voicemail drops',
  )
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
