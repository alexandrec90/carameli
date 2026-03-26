import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Phone,
  PhoneCall,
  MessageSquare,
  Settings,
  Radio,
  Menu,
  X,
} from 'lucide-react'

import type { LayoutProps } from '../types'

// Icons are carameli-specific; paths/labels come from the shared route list.
const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  '/': LayoutDashboard,
  '/phone-lines': Phone,
  '/extensions': PhoneCall,
  '/sms': MessageSquare,
  '/calls': Radio,
  '/settings': Settings,
}

export function Layout({ children, navItems: rawNavItems }: LayoutProps) {
  const navItems = rawNavItems.map((item) => ({ to: item.path, label: item.label, icon: ICONS[item.path] ?? Settings }))
  const [menuOpen, setMenuOpen] = useState(false)

  const sidebar = (
    <>
      {/* Logo */}
      <div className="px-6 py-8">
        <div className="flex items-center gap-2">
          <div
            className="w-10 h-10 rounded-[12px] flex items-center justify-center"
            style={{ background: 'linear-gradient(to bottom right, #FF9F1C, #E68A00)' }}
          >
            <Phone size={18} className="text-[#1A0F00]" />
          </div>
          <h1 className="carameli-wordmark text-[2.15rem] leading-none" data-text="Carameli">Carameli</h1>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pb-6 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-[16px] font-medium text-sm ${isActive
                ? 'text-[#1A0F00]'
                : 'text-[rgba(255,244,224,0.6)] nav-item'
              }`
            }
            style={({ isActive }) =>
              isActive
                ? {
                  background: 'linear-gradient(to right, #FF9F1C, #E68A00)',
                  boxShadow: '0 4px 12px -2px rgba(255, 159, 28, 0.35)',
                }
                : {}
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Status */}
      <div className="px-6 pb-6">
        <div
          className="rounded-[16px] px-4 py-3 flex items-center gap-2"
          style={{ background: 'rgba(255,159,28,0.08)' }}
        >
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="field-label">API Online</span>
        </div>
      </div>
    </>
  )

  return (
    <div
      className="min-h-screen flex"
      style={{
        background: [
          'radial-gradient(ellipse 130% 28% at 42% -10%, rgb(110 52 8 / 52%) 0%, transparent 68%)',
          'radial-gradient(ellipse 62% 42% at -8% 44%, rgb(168 78 14 / 30%) 0%, transparent 66%)',
          'radial-gradient(ellipse 52% 36% at 108% 56%, rgb(138 63 10 / 24%) 0%, transparent 62%)',
          'radial-gradient(ellipse 88% 52% at 50% 52%, rgb(90 42 6 / 42%) 0%, transparent 74%)',
          'radial-gradient(ellipse 72% 28% at 50% 112%, rgb(255 185 90 / 8%) 0%, transparent 66%)',
          'linear-gradient(155deg, #070400 0%, #0e0600 15%, #180a00 35%, #1d0d00 52%, #1a0f00 70%, #160c00 100%)',
        ].join(', '),
        color: 'var(--color-accent-cream)',
        minHeight: '100vh',
        overflowX: 'hidden',
        position: 'relative',
      }}
    >
      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 glass-sidebar md:hidden">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-[10px] flex items-center justify-center"
            style={{ background: 'linear-gradient(to bottom right, #FF9F1C, #E68A00)' }}
          >
            <Phone size={14} className="text-[#1A0F00]" />
          </div>
          <span className="carameli-wordmark text-[1.6rem] leading-none" data-text="Carameli">Carameli</span>
        </div>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-2 rounded-[12px] text-[var(--color-accent-cream)]"
          style={{ background: 'rgba(255,159,28,0.1)' }}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile drawer overlay */}
      {menuOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMenuOpen(false)}
          onKeyDown={() => setMenuOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed top-0 left-0 z-40 h-full w-64 flex flex-col glass-sidebar transition-transform duration-300 md:hidden ${menuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        {sidebar}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-shrink-0 flex-col glass-sidebar">
        {sidebar}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-4 pt-16 md:p-8 md:pt-8">{children}</main>
    </div>
  )
}
