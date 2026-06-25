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

/**
 * A per-row action button (e.g. Deactivate). The handler receives the full row
 * record, so the hook can stash an identifier in a non-column key (e.g. `id`) and
 * read it back here without that key being rendered as a cell.
 */
export interface DataRowAction {
  key: string
  label: string
  onClick: (row: Record<string, string>) => void
  variant?: 'primary' | 'default' | 'danger'
  disabled?: (row: Record<string, string>) => boolean
}

/** A single field in a create form. All values are strings; a checkbox is `'true'`/`'false'`. */
export interface DataFormField {
  key: string
  label: string
  kind: 'text' | 'textarea' | 'checkbox'
  placeholder?: string
  required?: boolean
  /** Initial value when the form opens/resets (e.g. `'true'` for a default-on checkbox). */
  default?: string
}

/**
 * Optional create form for a DataPage. The renderer shows a button labelled
 * `newLabel` that toggles an inline form; submitting calls `onSubmit` with the
 * collected string values. The hook owns validation/feedback via the page `error`.
 */
export interface DataForm {
  newLabel: string
  submitLabel: string
  fields: DataFormField[]
  onSubmit: (values: Record<string, string>) => void | Promise<void>
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
  rowActions?: DataRowAction[]
  form?: DataForm
  emptyText?: string
}
