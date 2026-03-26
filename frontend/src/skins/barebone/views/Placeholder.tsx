import type { PlaceholderProps } from '../../types'

export default function Placeholder({ title, description }: PlaceholderProps) {
    return (
        <div>
            <h1 style={{ fontSize: 20, marginTop: 0 }}>{title}</h1>
            <p style={{ color: '#666666', fontSize: 14 }}>{description}</p>
        </div>
    )
}
