import type React from 'react'
import type { NavItem } from '../routes'
import type { UseDashboardResult } from '../hooks/useDashboard'
import type { UsePhoneLinesResult } from '../hooks/usePhoneLines'
import type { UseExtensionsResult } from '../hooks/useExtensions'

export interface PlaceholderProps {
  title: string
  description: string
}

export interface SkinViews {
  Dashboard: React.ComponentType<UseDashboardResult>
  PhoneLines: React.ComponentType<UsePhoneLinesResult>
  Extensions: React.ComponentType<UseExtensionsResult>
  Placeholder: React.ComponentType<PlaceholderProps>
}

export interface LayoutProps {
  children: React.ReactNode
  navItems: NavItem[]
}

export interface Skin {
  Layout: React.ComponentType<LayoutProps>
  views: SkinViews
}
