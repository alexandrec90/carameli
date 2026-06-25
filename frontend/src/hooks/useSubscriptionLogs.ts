import { usePlaceholderPage } from './usePlaceholderPage'
import type { DataPageProps } from '../lib/dataPage'

/**
 * Subscription (API) Logs (cloudli spec §3). Structural placeholder: webhook-delivery
 * events have no producer in Carameli yet, so the log has no rows to show until the
 * delivery sender lands (see docs/plans/plan-B-feature-verticals.md §B5).
 */
export function useSubscriptionLogs(): DataPageProps {
  return usePlaceholderPage({
    title: 'Subscription Logs',
    description: 'API events delivered to webhook subscriptions',
    route: '/subscription-logs',
    columns: [
      { key: 'num', label: '#' },
      { key: 'date', label: 'Date' },
      { key: 'subscription', label: 'Subscription' },
      { key: 'event', label: 'Event' },
      { key: 'target', label: 'Target' },
      { key: 'success', label: 'Success' },
    ],
    emptyText: 'No subscription events recorded yet',
  })
}
