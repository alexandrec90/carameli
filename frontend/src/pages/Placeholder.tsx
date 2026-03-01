import { useSkin } from '../skins/context'

interface Props {
  title: string
  description: string
}

export default function Placeholder({ title, description }: Props) {
  const { views } = useSkin()
  return <views.Placeholder title={title} description={description} />
}
