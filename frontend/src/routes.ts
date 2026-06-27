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
    { path: '/reports', label: 'CDR Summary', element: lazy(() => import('./pages/CallReports')) },
    { path: '/webhooks', label: 'Webhooks', element: lazy(() => import('./pages/Webhooks')) },
    { path: '/subscription-logs', label: 'Subscription Logs', element: lazy(() => import('./pages/SubscriptionLogs')) },
    { path: '/contacts', label: 'Contacts', element: lazy(() => import('./pages/Contacts')) },
    { path: '/contact-groups', label: 'Contact Groups', element: lazy(() => import('./pages/ContactGroups')) },
    { path: '/users', label: 'Users', element: lazy(() => import('./pages/Users')) },
    { path: '/agents', label: 'Agents', element: lazy(() => import('./pages/Agents')) },
    { path: '/call-queues', label: 'Call Queues', element: lazy(() => import('./pages/CallQueues')) },
    { path: '/agent-skills', label: 'Agent Skills', element: lazy(() => import('./pages/AgentSkills')) },
    { path: '/music-tracks', label: 'Music Tracks', element: lazy(() => import('./pages/MusicTracks')) },
    { path: '/on-hold', label: 'Custom On Hold', element: lazy(() => import('./pages/CustomOnHold')) },
    { path: '/advertising', label: 'Advertising', element: lazy(() => import('./pages/Advertising')) },
    { path: '/prompts', label: 'Prompts', element: lazy(() => import('./pages/Prompts')) },
    { path: '/voicemail-greetings', label: 'Voicemail Greetings', element: lazy(() => import('./pages/VoicemailGreetings')) },
    { path: '/voicemail-broadcast', label: 'Voicemail Broadcast', element: lazy(() => import('./pages/VoicemailBroadcast')) },
    { path: '/mailbox-drop', label: 'Mailbox Drop History', element: lazy(() => import('./pages/MailboxDropList')) },
    { path: '/exemption-codes', label: 'Exemption Codes', element: lazy(() => import('./pages/ExemptionCodes')) },
    { path: '/expansion-modules', label: 'Expansion Modules', element: lazy(() => import('./pages/ExpansionModules')) },
    { path: '/speed-dials', label: 'Speed Dials', element: lazy(() => import('./pages/SpeedDials')) },
    { path: '/api-tokens', label: 'API Token', element: lazy(() => import('./pages/ApiTokens')) },
    { path: '/console', label: 'Console', element: lazy(() => import('./pages/Console')) },
    { path: '/settings', label: 'Settings', element: lazy(() => import('./pages/Settings')) },
]

/** Nav items for skin layouts — path + label only, no component leak. */
export const NAV_ITEMS: NavItem[] = ROUTES.map(({ path, label }) => ({ path, label }))
