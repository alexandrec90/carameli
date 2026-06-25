import type { DataPageProps } from '../../types'

// Barebone implementation of the functional-placeholder data page. Inline styles
// only, every field rendered, no animation — per the barebone skin's hard rules.
export default function DataPage({
    title,
    description,
    loading,
    error,
    filters,
    onFilterChange,
    columns,
    rows,
    actions,
    emptyText = 'No records',
}: DataPageProps) {
    return (
        <div>
            <h1 style={{ fontSize: 20, marginTop: 0 }}>{title}</h1>
            {description && <p style={{ color: '#666666', fontSize: 14 }}>{description}</p>}

            {(filters.length > 0 || actions.length > 0) && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', margin: '12px 0' }}>
                    {filters.map((f) => (
                        <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#666666' }}>
                            {f.label}
                            <input
                                type={f.kind === 'date' ? 'date' : 'search'}
                                value={f.value}
                                onChange={(e) => onFilterChange(f.key, e.target.value)}
                                style={{ border: '1px solid #cccccc', padding: '4px 8px', fontSize: 14 }}
                            />
                        </label>
                    ))}
                    {actions.map((a) => (
                        <button
                            key={a.key}
                            onClick={a.onClick}
                            disabled={a.disabled}
                            style={{
                                border: `1px solid ${a.variant === 'danger' ? '#cc0000' : '#0057b8'}`,
                                padding: '4px 12px',
                                background: a.variant === 'danger' ? '#cc0000' : '#0057b8',
                                color: '#ffffff',
                                fontSize: 13,
                                cursor: a.disabled ? 'not-allowed' : 'pointer',
                                opacity: a.disabled ? 0.5 : 1,
                            }}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            )}

            {error && <p style={{ color: '#cc0000', fontSize: 13 }}>{error}</p>}

            {loading ? (
                <p style={{ color: '#666666', fontSize: 13 }}>Loading...</p>
            ) : rows.length === 0 ? (
                <p style={{ color: '#666666', fontSize: 13 }}>{emptyText}</p>
            ) : (
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                        <tr>
                            {columns.map((c) => (
                                <th
                                    key={c.key}
                                    style={{
                                        textAlign: 'left',
                                        borderBottom: '2px solid #cccccc',
                                        padding: '6px 8px',
                                        fontSize: 12,
                                        textTransform: 'uppercase',
                                        color: '#666666',
                                    }}
                                >
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={i}>
                                {columns.map((c) => (
                                    <td key={c.key} style={{ padding: '6px 8px', borderBottom: '1px solid #eeeeee' }}>
                                        {row[c.key] ?? ''}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}
