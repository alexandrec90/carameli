import type { UseExtensionsResult } from '../../../hooks/useExtensions'

export default function Extensions(props: UseExtensionsResult) {
    const { available, extNumber, setExtNumber, adding, error, success, addExtension } = props

    return (
        <div style={{ padding: 24, paddingLeft: 216 }}>
            <h1 className="cb-title" style={{ marginBottom: 16 }}>Extensions</h1>

            {/* Add extension form */}
            <div className="cb-card" style={{ maxWidth: 360, padding: 16, marginBottom: 24 }}>
                <div className="cb-card-accent-bar" style={{ background: 'var(--cb-red)' }} />
                <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                        className="cb-input"
                        type="text"
                        placeholder="Ext. number"
                        value={extNumber}
                        onChange={e => setExtNumber(e.target.value)}
                        style={{ width: 130 }}
                    />
                    <button
                        className="cb-button"
                        style={{ '--cb-accent': 'var(--cb-red)' } as React.CSSProperties}
                        onClick={addExtension}
                        disabled={adding}
                    >
                        {adding ? 'Adding...' : 'Add Ext'}
                    </button>
                </div>
                {error && <p className="cb-error" style={{ marginTop: 8 }}>{error}</p>}
                {success && <p className="cb-success" style={{ marginTop: 8 }}>{success}</p>}
            </div>

            {/* Available extensions */}
            {available && available.available.length > 0 ? (
                <div className="cb-card" style={{ maxWidth: 400, padding: 16 }}>
                    <div className="cb-card-accent-bar" style={{ background: 'var(--cb-red)' }} />
                    <div style={{ marginTop: 12 }}>
                        <span className="cb-label" style={{ '--cb-accent': 'var(--cb-red)' } as React.CSSProperties}>
                            Available Extensions
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                            {available.available.map(ext => (
                                <span
                                    key={ext}
                                    role="button"
                                    tabIndex={0}
                                    className="cb-font-body"
                                    style={{
                                        border: '2px solid #111',
                                        padding: '2px 8px',
                                        background: 'var(--cb-white)',
                                        cursor: 'pointer',
                                    }}
                                    onClick={() => setExtNumber(ext)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExtNumber(ext) }}
                                >
                                    {ext}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="cb-bubble">No extensions available!</div>
            )}
        </div>
    )
}
