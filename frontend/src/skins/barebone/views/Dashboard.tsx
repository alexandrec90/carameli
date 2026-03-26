import type { UseDashboardResult } from '../../../hooks/useDashboard'

export default function Dashboard({
    customer,
    phoneLines,
    lineCount,
    apiOnline,
    loading,
    seedDemoCustomer,
}: UseDashboardResult) {
    if (loading) return <p>Loading...</p>

    return (
        <div>
            <h1 style={{ fontSize: 20, marginTop: 0 }}>Dashboard</h1>

            {/* API status */}
            <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16 }}>API Status</h2>
                {apiOnline === null ? (
                    <span>Checking...</span>
                ) : apiOnline ? (
                    <span
                        style={{
                            fontSize: 11,
                            padding: '2px 6px',
                            borderRadius: 3,
                            background: '#d4edda',
                            color: '#007700',
                        }}
                    >
                        Online
                    </span>
                ) : (
                    <span
                        style={{
                            fontSize: 11,
                            padding: '2px 6px',
                            borderRadius: 3,
                            background: '#f8d7da',
                            color: '#cc0000',
                        }}
                    >
                        Offline
                    </span>
                )}
            </section>

            {/* Customer info */}
            <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16 }}>Customer</h2>
                {customer ? (
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <tbody>
                            <tr>
                                <td
                                    style={{
                                        padding: '6px 8px',
                                        borderBottom: '1px solid #eeeeee',
                                        fontSize: 12,
                                        color: '#666666',
                                        width: 160,
                                    }}
                                >
                                    Customer ID
                                </td>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid #eeeeee' }}>
                                    {customer.vs_customer_id}
                                </td>
                            </tr>
                            <tr>
                                <td
                                    style={{
                                        padding: '6px 8px',
                                        borderBottom: '1px solid #eeeeee',
                                        fontSize: 12,
                                        color: '#666666',
                                    }}
                                >
                                    Phone lines
                                </td>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid #eeeeee' }}>
                                    {lineCount}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                ) : (
                    <div>
                        <p style={{ color: '#666666', fontSize: 13 }}>No demo customer found.</p>
                        <button
                            onClick={seedDemoCustomer}
                            style={{
                                border: '1px solid #0057b8',
                                padding: '4px 12px',
                                background: '#0057b8',
                                color: '#ffffff',
                                fontSize: 13,
                                cursor: 'pointer',
                            }}
                        >
                            Seed demo customer
                        </button>
                    </div>
                )}
            </section>

            {/* Phone lines summary */}
            {phoneLines.length > 0 && (
                <section>
                    <h2 style={{ fontSize: 16 }}>Phone Lines ({phoneLines.length})</h2>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead>
                            <tr>
                                <th
                                    style={{
                                        textAlign: 'left',
                                        borderBottom: '2px solid #cccccc',
                                        padding: '6px 8px',
                                        fontSize: 12,
                                        textTransform: 'uppercase',
                                        color: '#666666',
                                    }}
                                >
                                    Number
                                </th>
                                <th
                                    style={{
                                        textAlign: 'left',
                                        borderBottom: '2px solid #cccccc',
                                        padding: '6px 8px',
                                        fontSize: 12,
                                        textTransform: 'uppercase',
                                        color: '#666666',
                                    }}
                                >
                                    Status
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {phoneLines.map((line) => (
                                <tr key={line.phone_number}>
                                    <td
                                        style={{
                                            padding: '6px 8px',
                                            borderBottom: '1px solid #eeeeee',
                                            fontFamily: 'monospace',
                                        }}
                                    >
                                        {line.phone_number}
                                    </td>
                                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eeeeee' }}>
                                        {line.active ? 'Active' : 'Inactive'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}
        </div>
    )
}
