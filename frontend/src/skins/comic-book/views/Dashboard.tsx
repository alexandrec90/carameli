import type { UseDashboardResult } from '../../../hooks/useDashboard'

export default function Dashboard(props: UseDashboardResult) {
    const { customer, phoneLines, lineCount, apiOnline, loading, seedDemoCustomer } = props

    return (
        <div style={{ padding: 24, paddingLeft: 216 }}>
            <h1 className="cb-title" style={{ marginBottom: 16 }}>Command Center</h1>

            {loading && (
                <div className="cb-bubble">Loading...</div>
            )}

            {!loading && apiOnline === false && (
                <div className="cb-bubble error">API Offline!</div>
            )}

            {!loading && apiOnline && (
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    {/* Status panel */}
                    <div className="cb-card" style={{ minWidth: 220, padding: 16 }}>
                        <div className="cb-card-accent-bar" style={{ background: 'var(--cb-yellow)' }} />
                        <div style={{ marginTop: 12 }}>
                            <span className="cb-label" style={{ '--cb-accent': 'var(--cb-yellow)' } as React.CSSProperties}>
                                Status
                            </span>
                            <p className="cb-font-body" style={{ marginTop: 8 }}>
                                API: <strong style={{ color: 'var(--cb-green)' }}>Online</strong>
                            </p>
                            <p className="cb-font-body">
                                Lines: <strong>{lineCount}</strong>
                            </p>
                        </div>
                    </div>

                    {/* Customer panel */}
                    {customer ? (
                        <div className="cb-card" style={{ minWidth: 260, padding: 16 }}>
                            <div className="cb-card-accent-bar" style={{ background: 'var(--cb-blue)' }} />
                            <div style={{ marginTop: 12 }}>
                                <span className="cb-label" style={{ '--cb-accent': 'var(--cb-blue)' } as React.CSSProperties}>
                                    Customer
                                </span>
                                <p className="cb-font-body" style={{ marginTop: 8 }}>Customer #{customer.vs_customer_id}</p>
                                <p className="cb-font-body" style={{ color: '#555' }}>ID: {customer.id}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="cb-card" style={{ minWidth: 260, padding: 16 }}>
                            <div className="cb-card-accent-bar" style={{ background: 'var(--cb-red)' }} />
                            <div style={{ marginTop: 12 }}>
                                <p className="cb-font-body">No customer found.</p>
                                <button className="cb-button" style={{ marginTop: 12 }} onClick={seedDemoCustomer}>
                                    Seed Demo
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Phone lines preview */}
                    {phoneLines.length > 0 && (
                        <div className="cb-card" style={{ minWidth: 260, padding: 16 }}>
                            <div className="cb-card-accent-bar" style={{ background: 'var(--cb-cyan)' }} />
                            <div style={{ marginTop: 12 }}>
                                <span className="cb-label" style={{ '--cb-accent': 'var(--cb-cyan)' } as React.CSSProperties}>
                                    Lines
                                </span>
                                <ul style={{ marginTop: 8, paddingLeft: 0, listStyle: 'none' }}>
                                    {phoneLines.slice(0, 4).map(line => (
                                        <li key={line.phone_number} className="cb-font-body" style={{ borderBottom: '1px solid #ccc', padding: '4px 0' }}>
                                            {line.phone_number}
                                        </li>
                                    ))}
                                    {phoneLines.length > 4 && (
                                        <li className="cb-font-body" style={{ color: '#888', paddingTop: 4 }}>
                                            +{phoneLines.length - 4} more...
                                        </li>
                                    )}
                                </ul>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
