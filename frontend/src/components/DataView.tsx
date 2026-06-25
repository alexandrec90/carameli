import { Card } from './Card'
import { Button } from './Button'
import type { DataPageProps } from '../skins/types'

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
  emptyText = 'No records',
}: DataPageProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title text-4xl font-extrabold">{title}</h1>
        {description && (
          <p className="page-subtitle text-base font-medium mt-1">{description}</p>
        )}
      </div>

      {(filters.length > 0 || actions.length > 0) && (
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
              {actions.map((a) => (
                <Button
                  key={a.key}
                  size="sm"
                  variant={a.variant === 'primary' ? 'primary' : 'ghost'}
                  onClick={a.onClick}
                  disabled={a.disabled}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </div>
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
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
