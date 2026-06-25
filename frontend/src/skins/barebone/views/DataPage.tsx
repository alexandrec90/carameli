import { useState } from 'react'
import type { DataForm, DataPageProps } from '../../types'

// Barebone implementation of the functional-placeholder data page. Inline styles
// only, every field rendered, no animation — per the barebone skin's hard rules.

const inputStyle = { border: '1px solid #cccccc', padding: '4px 8px', fontSize: 14 } as const

function btnStyle(danger: boolean, disabled = false) {
    return {
        border: `1px solid ${danger ? '#cc0000' : '#0057b8'}`,
        padding: '4px 12px',
        background: danger ? '#cc0000' : '#0057b8',
        color: '#ffffff',
        fontSize: 13,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
    } as const
}

function blankFormValues(form: DataForm): Record<string, string> {
    return Object.fromEntries(
        form.fields.map((f) => [f.key, f.default ?? (f.kind === 'checkbox' ? 'false' : '')])
    )
}

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
    rowActions,
    form,
    emptyText = 'No records',
}: DataPageProps) {
    const [showForm, setShowForm] = useState(false)
    const [values, setValues] = useState<Record<string, string>>(() =>
        form ? blankFormValues(form) : {}
    )

    const submit = async () => {
        if (!form) return
        await form.onSubmit(values)
        setValues(blankFormValues(form))
        setShowForm(false)
    }

    const hasRowActions = !!rowActions && rowActions.length > 0

    return (
        <div>
            <h1 style={{ fontSize: 20, marginTop: 0 }}>{title}</h1>
            {description && <p style={{ color: '#666666', fontSize: 14 }}>{description}</p>}

            {(filters.length > 0 || actions.length > 0 || form) && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', margin: '12px 0' }}>
                    {filters.map((f) => (
                        <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#666666' }}>
                            {f.label}
                            <input
                                type={f.kind === 'date' ? 'date' : 'search'}
                                value={f.value}
                                onChange={(e) => onFilterChange(f.key, e.target.value)}
                                style={inputStyle}
                            />
                        </label>
                    ))}
                    {form && (
                        <button onClick={() => setShowForm((s) => !s)} style={btnStyle(false)}>
                            {form.newLabel}
                        </button>
                    )}
                    {actions.map((a) => (
                        <button
                            key={a.key}
                            onClick={a.onClick}
                            disabled={a.disabled}
                            style={btnStyle(a.variant === 'danger', a.disabled)}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            )}

            {error && <p style={{ color: '#cc0000', fontSize: 13 }}>{error}</p>}

            {form && showForm && (
                <form
                    onSubmit={(e) => {
                        e.preventDefault()
                        void submit()
                    }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0', maxWidth: 480 }}
                >
                    {form.fields.map((field) => (
                        <label key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#666666' }}>
                            {field.label}
                            {field.kind === 'checkbox' ? (
                                <input
                                    type="checkbox"
                                    checked={values[field.key] === 'true'}
                                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: String(e.target.checked) }))}
                                    style={{ alignSelf: 'flex-start' }}
                                />
                            ) : (
                                <input
                                    type="text"
                                    value={values[field.key] ?? ''}
                                    required={field.required}
                                    placeholder={field.placeholder}
                                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                                    style={inputStyle}
                                />
                            )}
                        </label>
                    ))}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button type="submit" style={btnStyle(false)}>{form.submitLabel}</button>
                        <button type="button" onClick={() => setShowForm(false)} style={btnStyle(false)}>Cancel</button>
                    </div>
                </form>
            )}

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
                            {hasRowActions && (
                                <th style={{ textAlign: 'left', borderBottom: '2px solid #cccccc', padding: '6px 8px', fontSize: 12, textTransform: 'uppercase', color: '#666666' }}>
                                    Actions
                                </th>
                            )}
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
                                {hasRowActions && (
                                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eeeeee' }}>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            {rowActions!.map((a) => {
                                                const disabled = a.disabled ? a.disabled(row) : false
                                                return (
                                                    <button
                                                        key={a.key}
                                                        onClick={() => a.onClick(row)}
                                                        disabled={disabled}
                                                        style={btnStyle(a.variant === 'danger', disabled)}
                                                    >
                                                        {a.label}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}
