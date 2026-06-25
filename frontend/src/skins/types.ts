import type React from 'react'
import type { NavItem } from '../routes'
import type { UseDashboardResult } from '../hooks/useDashboard'
import type { UsePhoneLinesResult } from '../hooks/usePhoneLines'
import type { UseExtensionsResult } from '../hooks/useExtensions'
import type { DataPageProps } from '../lib/dataPage'

export interface PlaceholderProps {
  title: string
  description: string
}

// Functional-placeholder descriptor types live in lib/dataPage.ts so data hooks
// can return them without importing from skins/. Re-exported here as part of the
// skin contract.
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
  Placeholder: React.ComponentType<PlaceholderProps>
  DataPage: React.ComponentType<DataPageProps>
}

export interface LayoutProps {
  children: React.ReactNode
  navItems: NavItem[]
}

export interface Skin {
  Layout: React.ComponentType<LayoutProps>
  views: SkinViews
}
