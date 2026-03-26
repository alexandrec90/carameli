import type { UsePhoneLinesResult } from '../../../hooks/usePhoneLines'

const thStyle: React.CSSProperties = {
    textAlign: 'left',
    borderBottom: '2px solid #cccccc',
    padding: '6px 8px',
    fontSize: 12,
    textTransform: 'uppercase',
    color: '#666666',
}

const tdStyle: React.CSSProperties = {
    padding: '6px 8px',
    borderBottom: '1px solid #eeeeee',
}

export default function PhoneLines({
    lines,
    loading,
    areaCode,
    setAreaCode,
    adding,
    error,
    addLine,
    deactivate,
}: UsePhoneLinesResult) {
    if (loading) return <p>Loading...</p>

    return (
        <div>
            <h1 style={{ fontSize: 20, marginTop: 0 }}>Phone Lines</h1>

            {/* Add line form */}
            <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16 }}>Add Line</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                        type="text"
                        placeholder="Area code (e.g. 512)"
                        value={areaCode}
                        onChange={(e) => setAreaCode(e.target.value)}
                        style={{
                            border: '1px solid #cccccc',
                            padding: '4px 8px',
                            fontSize: 14,
                            fontFamily: 'system-ui, sans-serif',
                        }}
                    />
                    <button
                        onClick={addLine}
                        disabled={adding || !areaCode.trim()}
                        style={{
                            border: '1px solid #0057b8',
                            padding: '4px 12px',
                            background: '#0057b8',
                            color: '#ffffff',
                            fontSize: 13,
                            cursor: adding || !areaCode.trim() ? 'not-allowed' : 'pointer',
                            opacity: adding || !areaCode.trim() ? 0.5 : 1,
                        }}
                    >
                        {adding ? 'Adding...' : 'Add'}
                    </button>
                </div>
                {error && (
                    <p style={{ color: '#cc0000', fontSize: 13, marginTop: 8 }}>{error}</p>
                )}
            </section>

            {/* Lines table */}
            <section>
                <h2 style={{ fontSize: 16 }}>All Lines ({lines.length})</h2>
                {lines.length === 0 ? (
                    <p style={{ color: '#666666', fontSize: 13 }}>No phone lines found.</p>
                ) : (
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead>
                            <tr>
                                <th style={thStyle}>Number</th>
                                <th style={thStyle}>Status</th>
                                <th style={thStyle}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((line) => (
                                <tr key={line.phone_number}>
                                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{line.phone_number}</td>
                                    <td style={tdStyle}>{line.active ? 'Active' : 'Inactive'}</td>
                                    <td style={tdStyle}>
                                        {line.active && (
                                            <button
                                                onClick={() => deactivate(line.phone_number)}
                                                style={{
                                                    border: '1px solid #cc0000',
                                                    padding: '2px 8px',
                                                    background: 'transparent',
                                                    color: '#cc0000',
                                                    fontSize: 12,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                Deactivate
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    )
}
