import { Construction } from 'lucide-react'
import { Card } from '../components/Card'

interface Props {
  title: string
  description: string
}

export default function Placeholder({ title, description }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[#FFF4E0] text-4xl font-extrabold">{title}</h1>
        <p className="text-[rgba(255,244,224,0.6)] text-base font-medium mt-1">{description}</p>
      </div>
      <Card>
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Construction size={48} className="text-[rgba(255,159,28,0.4)]" />
          <p className="text-[rgba(255,244,224,0.4)] text-base font-medium">
            Coming soon — API endpoints are ready, UI in progress
          </p>
        </div>
      </Card>
    </div>
  )
}
