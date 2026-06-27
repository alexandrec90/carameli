import { useVoicemailDropEvents } from '../hooks/useVoicemailDropEvents'
import { useSkin } from '../skins/context'

export default function MailboxDropList() {
  const data = useVoicemailDropEvents(
    'Mailbox Drop History',
    'History of voicemail drops initiated via the VsMessageDrop API',
  )
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
