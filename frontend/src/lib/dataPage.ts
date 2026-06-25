/**
 * Descriptor types for "functional placeholder" data pages — a neutral home (not
 * under skins/ or hooks/) so a data hook can return a DataPageProps without
 * importing from the skin layer. The skin contract (skins/types.ts) re-exports
 * these; the shared renderer (components/DataView.tsx) and per-skin views consume
 * them. Mirrors the structure in docs/cloudli/cloudli-functional-spec.md.
 */
export interface DataColumn {
  key: string
  label: string
}

export interface DataFilter {
  key: string
  label: string
  kind: 'search' | 'date'
  value: string
}

export interface DataAction {
  key: string
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'default' | 'danger'
}

export interface DataPageProps {
  title: string
  description?: string
  loading: boolean
  error?: string
  filters: DataFilter[]
  onFilterChange: (key: string, value: string) => void
  columns: DataColumn[]
  rows: Array<Record<string, string>>
  actions: DataAction[]
  emptyText?: string
}
