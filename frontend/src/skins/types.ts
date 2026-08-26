import type React from 'react'
import type { NavItem } from '../routes'
import type { UseDashboardResult } from '../hooks/useDashboard'
import type { UsePhoneLinesResult } from '../hooks/usePhoneLines'
import type { UseExtensionsResult } from '../hooks/useExtensions'
import type { UseSoftphoneResult } from '../hooks/useSoftphone'
import type { UseSmsConversationsResult } from '../hooks/useSmsConversations'
import type { DataPageProps } from '../lib/dataPage'

export interface PlaceholderProps {
  title: string
  description: string
}

// Functional-placeholder descriptor types live in lib/dataPage.ts so data hooks
// can return them without importing from skins/. Re-exported here as part of the
// skin contract.
//
// Only `DataForm` and `DataPageProps` have a skin importing them today, so the rest
// read as dead re-exports to the dead-weight check. They are deliberate: a skin author
// writing a table or a filter bar reaches for `DataColumn` and `DataFilter` from here,
// and sending them to `lib/dataPage` instead would mean skins importing across the
// boundary this module exists to draw. `@public` is the claim that they are surface
// rather than leftovers — delete the tag if that stops being true.
/** @public */
export type {
  DataColumn,
  DataFilter,
  DataAction,
  DataRowAction,
  DataFormField,
  DataForm,
  DataPageProps,
} from '../lib/dataPage'

export interface SkinViews {
  Dashboard: React.ComponentType<UseDashboardResult>
  PhoneLines: React.ComponentType<UsePhoneLinesResult>
  Extensions: React.ComponentType<UseExtensionsResult>
  Softphone: React.ComponentType<UseSoftphoneResult>
  Placeholder: React.ComponentType<PlaceholderProps>
  DataPage: React.ComponentType<DataPageProps>
}

export interface LayoutProps {
  children: React.ReactNode
  navItems: NavItem[]
  /**
   * Live SMS threads for skins whose *chrome* — not one of its views — shows a
   * conversation. The comic-book skin's bubble chains are that case: they are drawn by
   * the Layout, so there is no view whose props could carry them.
   *
   * It is a subscription rather than a payload because the number being shown is the
   * skin's to know (a wheel-picker balloon the reader turns), while the fetching stays
   * in `useSmsConversations`. A skin that subscribes to nothing costs nothing.
   */
  sms: UseSmsConversationsResult
  /**
   * The app's single softphone, for a skin that puts a telephone in the page furniture
   * rather than only on the /softphone route. Presentation-only skins ignore it.
   */
  softphone: UseSoftphoneResult
}

export interface Skin {
  Layout: React.ComponentType<LayoutProps>
  views: SkinViews
}
