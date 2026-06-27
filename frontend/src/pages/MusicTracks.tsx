import { useAudioAssets } from '../hooks/useAudioAssets'
import { useSkin } from '../skins/context'

export default function MusicTracks() {
  const data = useAudioAssets('music', 'Music Tracks', 'Background music files played in call queues')
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
