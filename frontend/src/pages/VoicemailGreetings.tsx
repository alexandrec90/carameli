import { useAudioAssets } from '../hooks/useAudioAssets'
import { useSkin } from '../skins/context'

export default function VoicemailGreetings() {
  const data = useAudioAssets('greeting', 'Voicemail Greetings', 'Outgoing voicemail greeting recordings')
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
