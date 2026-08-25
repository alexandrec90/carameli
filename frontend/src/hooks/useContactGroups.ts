import { usePlaceholderPage } from './usePlaceholderPage'
import type { DataPageProps } from '../lib/dataPage'

/**
 * Contact Groups (legacy feature spec §8). Structural placeholder: owned by CRM,
 * not Carameli (see docs/plans/active/frontend-parity/plan-B-feature-verticals.md §B1).
 */
export function useContactGroups(): DataPageProps {
  return usePlaceholderPage({
    title: 'Contact Groups',
    description: 'Contact groups (managed in CRM)',
    route: '/contact-groups',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'data', label: 'Data' },
    ],
    emptyText: 'Contact groups are managed in CRM',
  })
}
