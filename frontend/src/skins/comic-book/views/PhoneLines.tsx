import type { UsePhoneLinesResult } from '../../../hooks/usePhoneLines'

export default function PhoneLines(props: UsePhoneLinesResult) {
    const { lines, loading, areaCode, setAreaCode, adding, error, addLine, deactivate } = props

    return (
        <div style={{ padding: 24, paddingLeft: 216 }}>
            <h1 className="cb-title" style={{ marginBottom: 16 }}>Phone Lines</h1>

            {/* Add line form */}
            <div className="cb-card" style={{ maxWidth: 360, padding: 16, marginBottom: 24 }}>
                <div className="cb-card-accent-bar" style={{ background: 'var(--cb-blue)' }} />
                <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                        className="cb-input"
                        type="text"
                        placeholder="Area code"
                        value={areaCode}
                        onChange={e => setAreaCode(e.target.value)}
                        style={{ width: 110 }}
                    />
                    <button
                        className="cb-button"
                        onClick={addLine}
                        disabled={adding}
                    >
                        {adding ? 'Adding...' : 'Add Line'}
                    </button>
                </div>
                {error && <p className="cb-error" style={{ marginTop: 8 }}>{error}</p>}
            </div>

            {/* Lines list */}
            {loading ? (
                <div className="cb-bubble">Loading...</div>
            ) : lines.length === 0 ? (
                <div className="cb-bubble">No lines yet!</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 500 }}>
                    {lines.map(line => (
                        <div
                            key={line.phone_number}
                            className="cb-card"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}
                        >
                            <div className="cb-card-accent-bar" style={{ background: 'var(--cb-blue)' }} />
                            <span className="cb-font-body" style={{ marginTop: 4 }}>{line.phone_number}</span>
                            <span
                                className="cb-label"
                                style={{
                                    '--cb-accent': line.active ? 'var(--cb-green)' : 'var(--cb-red)',
                                } as React.CSSProperties}
                            >
                                {line.active ? 'Active' : 'Inactive'}
                            </span>
                            {line.active && (
                                <button
                                    className="cb-button"
                                    style={{ fontSize: 13, padding: '4px 10px' }}
                                    onClick={() => deactivate(line.phone_number)}
                                >
                                    Deactivate
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
