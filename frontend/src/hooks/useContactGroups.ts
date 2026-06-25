import { usePlaceholderPage } from './usePlaceholderPage'
import type { DataPageProps } from '../lib/dataPage'

/**
 * Contact Groups (cloudli spec §8). Structural placeholder: owned by VanillaSoft CRM,
 * not Carameli (see docs/plans/plan-B-feature-verticals.md §B1).
 */
export function useContactGroups(): DataPageProps {
  return usePlaceholderPage({
    title: 'Contact Groups',
    description: 'Contact groups (managed in VanillaSoft CRM)',
    route: '/contact-groups',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'data', label: 'Data' },
    ],
    emptyText: 'Contact groups are managed in VanillaSoft CRM',
  })
}
