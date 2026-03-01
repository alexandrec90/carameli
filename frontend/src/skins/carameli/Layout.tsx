import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Phone,
  PhoneCall,
  MessageSquare,
  Settings,
  Radio,
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
  return (
    <div className="min-h-screen flex">
      {/* Sidebar — static glass surface, lit by global ambient candlelight */}
      <aside className="w-64 flex-shrink-0 flex flex-col glass-sidebar">
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
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  )
}
