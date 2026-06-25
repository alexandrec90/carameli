import { useCallback, useState } from 'react'
import { Card } from './Card'
import { Button } from './Button'
import type { DataForm, DataPageProps } from '../skins/types'

function blankFormValues(form: DataForm): Record<string, string> {
  return Object.fromEntries(
    form.fields.map((f) => [f.key, f.default ?? (f.kind === 'checkbox' ? 'false' : '')])
  )
}

/**
 * Shared generic renderer for "functional placeholder" pages. Used by the tailwind
 * skins (carameli, candy-shop, comic-book) so a new page is functionally complete
 * across every skin before it gets bespoke per-skin art. The barebone skin ships its
 * own inline-styled implementation per its hard rules.
 */
export function DataView({
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

  const submit = useCallback(async () => {
    if (!form) return
    await form.onSubmit(values)
    setValues(blankFormValues(form))
    setShowForm(false)
  }, [form, values])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title text-4xl font-extrabold">{title}</h1>
        {description && (
          <p className="page-subtitle text-base font-medium mt-1">{description}</p>
        )}
      </div>

      {(filters.length > 0 || actions.length > 0 || form) && (
        <Card>
          <div className="flex gap-3 items-end flex-wrap">
            {filters.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-helper text-xs">{f.label}</span>
                <input
                  type={f.kind === 'date' ? 'date' : 'search'}
                  value={f.value}
                  placeholder={f.kind === 'search' ? f.label : undefined}
                  onChange={(e) => onFilterChange(f.key, e.target.value)}
                  className="ui-input px-4 py-2.5 rounded-[16px] outline-none focus:ring-2 focus:ring-[#FF9F1C]/40"
                  style={{
                    background: 'rgba(255,159,28,0.08)',
                    border: '1px solid rgba(255,244,224,0.1)',
                  }}
                />
              </label>
            ))}
            <div className="flex gap-2 ml-auto">
              {form && (
                <Button
                  key="new"
                  size="sm"
                  variant="primary"
                  onClick={() => setShowForm((s) => !s)}
                >
                  {form.newLabel}
                </Button>
              )}
              {actions.map((a) => (
                <Button
                  key={a.key}
                  size="sm"
                  variant={
                    a.variant === 'primary' ? 'primary' : a.variant === 'danger' ? 'danger' : 'ghost'
                  }
                  onClick={a.onClick}
                  disabled={a.disabled}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </div>
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

          {form && showForm && (
            <form
              className="mt-4 flex flex-col gap-3 border-t border-[rgba(255,244,224,0.12)] pt-4"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              {form.fields.map((field) => (
                <label key={field.key} className="flex flex-col gap-1">
                  <span className="text-helper text-xs">{field.label}</span>
                  {field.kind === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={values[field.key] === 'true'}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [field.key]: String(e.target.checked) }))
                      }
                      className="self-start w-5 h-5"
                    />
                  ) : (
                    <input
                      type="text"
                      value={values[field.key] ?? ''}
                      required={field.required}
                      placeholder={field.placeholder}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [field.key]: e.target.value }))
                      }
                      className="ui-input px-4 py-2.5 rounded-[16px] outline-none focus:ring-2 focus:ring-[#FF9F1C]/40"
                      style={{
                        background: 'rgba(255,159,28,0.08)',
                        border: '1px solid rgba(255,244,224,0.1)',
                      }}
                    />
                  )}
                </label>
              ))}
              <div className="flex gap-2">
                <Button key="submit" size="sm" variant="primary" type="submit">
                  {form.submitLabel}
                </Button>
                <Button
                  key="cancel"
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      <Card>
        {loading ? (
          <div className="shimmer h-32 rounded-[12px]" />
        ) : rows.length === 0 ? (
          <p className="text-body-soft text-sm py-8 text-center">{emptyText}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className="stat-label pb-3 pr-4 font-semibold">
                      {c.label}
                    </th>
                  ))}
                  {rowActions && rowActions.length > 0 && (
                    <th className="stat-label pb-3 pr-4 font-semibold">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-t border-[rgba(255,244,224,0.08)]">
                    {columns.map((c) => (
                      <td key={c.key} className="text-body-soft py-2.5 pr-4">
                        {row[c.key] ?? ''}
                      </td>
                    ))}
                    {rowActions && rowActions.length > 0 && (
                      <td className="py-2.5 pr-4">
                        <div className="flex gap-2">
                          {rowActions.map((a) => (
                            <Button
                              key={a.key}
                              size="sm"
                              variant={a.variant === 'danger' ? 'danger' : 'ghost'}
                              onClick={() => a.onClick(row)}
                              disabled={a.disabled ? a.disabled(row) : false}
                            >
                              {a.label}
                            </Button>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
