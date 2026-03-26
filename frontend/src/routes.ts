import { lazy } from 'react'
import type { ComponentType } from 'react'

export interface NavItem {
    path: string
    label: string
}

export interface RouteItem extends NavItem {
    element: ComponentType
}

/**
 * Canonical route list — single source of truth for navigation AND routing.
 * Add new routes here; every skin's Layout and App.tsx pick them up automatically.
 */
export const ROUTES: RouteItem[] = [
    { path: '/', label: 'Dashboard', element: lazy(() => import('./pages/Dashboard')) },
    { path: '/phone-lines', label: 'Phone Lines', element: lazy(() => import('./pages/PhoneLines')) },
    { path: '/extensions', label: 'Extensions', element: lazy(() => import('./pages/Extensions')) },
    { path: '/sms', label: 'SMS', element: lazy(() => import('./pages/Sms')) },
    { path: '/calls', label: 'Call Events', element: lazy(() => import('./pages/CallEvents')) },
    { path: '/settings', label: 'Settings', element: lazy(() => import('./pages/Settings')) },
]

/** Nav items for skin layouts — path + label only, no component leak. */
export const NAV_ITEMS: NavItem[] = ROUTES.map(({ path, label }) => ({ path, label }))
