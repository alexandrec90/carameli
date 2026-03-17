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

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/phone-lines', label: 'Phone Lines', icon: Phone },
  { to: '/extensions', label: 'Extensions', icon: PhoneCall },
  { to: '/sms', label: 'SMS', icon: MessageSquare },
  { to: '/calls', label: 'Call Events', icon: Radio },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Layout({ children }: { children: React.ReactNode }) {
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
    <div className="min-h-screen flex">
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
