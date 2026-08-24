import { usePlaceholderPage } from './usePlaceholderPage'
import type { DataPageProps } from '../lib/dataPage'

/**
 * Contacts (legacy feature spec §7). Structural placeholder: contact data is owned by
 * CRM, not Carameli (see docs/plans/active/frontend-parity/plan-B-feature-verticals.md §B1).
 */
export function useContacts(): DataPageProps {
  return usePlaceholderPage({
    title: 'Contacts',
    description: 'Contact directory (managed in CRM)',
    route: '/contacts',
    columns: [
      { key: 'last_name', label: 'Last Name' },
      { key: 'first_name', label: 'First Name' },
      { key: 'company', label: 'Company' },
      { key: 'function', label: 'Function' },
    ],
    emptyText: 'Contacts are managed in CRM',
  })
}
