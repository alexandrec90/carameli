import { usePlaceholderPage } from './usePlaceholderPage'
import type { DataPageProps } from '../lib/dataPage'

/**
 * Users (cloudli spec §1). Structural placeholder: organizational user management is a
 * VanillaSoft identity concern, not Carameli (see docs/plans/plan-B-feature-verticals.md §B5).
 */
export function useUsers(): DataPageProps {
  return usePlaceholderPage({
    title: 'Users',
    description: 'Organizational users (managed in VanillaSoft)',
    route: '/users',
    columns: [
      { key: 'last_name', label: 'Last Name' },
      { key: 'first_name', label: 'First Name' },
      { key: 'addresses', label: 'Addresses' },
      { key: 'telephones', label: 'Telephones' },
      { key: 'emails', label: 'Emails' },
      { key: 'sms_number', label: 'Text messaging number' },
      { key: 'user', label: 'User' },
      { key: 'id_number', label: 'Id Number' },
      { key: 'admin', label: 'Admin' },
    ],
    emptyText: 'Users are managed in VanillaSoft',
  })
}
