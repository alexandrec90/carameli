import type { PlaceholderProps } from '../../types'

export default function Placeholder({ title, description }: PlaceholderProps) {
    return (
        <div style={{ padding: 24, paddingLeft: 216, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 20 }}>
            <h1 className="cb-title">{title}</h1>
            <div className="cb-bubble" style={{ maxWidth: 400 }}>
                {description}
            </div>
        </div>
    )
}
