import type { UseExtensionsResult } from '../../../hooks/useExtensions'

export default function Extensions({
    available,
    extNumber,
    setExtNumber,
    adding,
    error,
    success,
    addExtension,
}: UseExtensionsResult) {
    return (
        <div>
            <h1 style={{ fontSize: 20, marginTop: 0 }}>Extensions</h1>

            {/* Available extensions */}
            <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16 }}>Available Numbers</h2>
                {available === null ? (
                    <p style={{ color: '#666666', fontSize: 13 }}>Loading...</p>
                ) : available.available.length === 0 ? (
                    <p style={{ color: '#666666', fontSize: 13 }}>No available extension numbers.</p>
                ) : (
                    <p style={{ fontSize: 13, color: '#666666' }}>
                        {available.available.length} available:{' '}
                        <span style={{ fontFamily: 'monospace' }}>
                            {available.available.slice(0, 10).join(', ')}
                            {available.available.length > 10 && ` … +${available.available.length - 10} more`}
                        </span>
                    </p>
                )}
            </section>

            {/* Add extension form */}
            <section>
                <h2 style={{ fontSize: 16 }}>Add Extension</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                        type="text"
                        placeholder="Extension number (e.g. 101)"
                        value={extNumber}
                        onChange={(e) => setExtNumber(e.target.value)}
                        style={{
                            border: '1px solid #cccccc',
                            padding: '4px 8px',
                            fontSize: 14,
                            fontFamily: 'system-ui, sans-serif',
                        }}
                    />
                    <button
                        onClick={addExtension}
                        disabled={adding || !extNumber.trim()}
                        style={{
                            border: '1px solid #0057b8',
                            padding: '4px 12px',
                            background: '#0057b8',
                            color: '#ffffff',
                            fontSize: 13,
                            cursor: adding || !extNumber.trim() ? 'not-allowed' : 'pointer',
                            opacity: adding || !extNumber.trim() ? 0.5 : 1,
                        }}
                    >
                        {adding ? 'Adding...' : 'Add'}
                    </button>
                </div>
                {error && (
                    <p style={{ color: '#cc0000', fontSize: 13, marginTop: 8 }}>{error}</p>
                )}
                {success && (
                    <p style={{ color: '#007700', fontSize: 13, marginTop: 8 }}>{success}</p>
                )}
            </section>
        </div>
    )
}
