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

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen flex" style={{ background: '#1A0F00' }}>
      {/* Sidebar */}
      <aside
        className="w-64 flex-shrink-0 flex flex-col"
        style={{
          background: 'rgba(26, 15, 0, 0.8)',
          backdropFilter: 'blur(25px)',
          WebkitBackdropFilter: 'blur(25px)',
          borderRight: '1px solid rgba(255, 244, 224, 0.06)',
        }}
      >
        {/* Logo */}
        <div className="px-6 py-8">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-[12px] flex items-center justify-center"
              style={{ background: 'linear-gradient(to bottom right, #FF9F1C, #E68A00)' }}
            >
              <Phone size={18} className="text-[#1A0F00]" />
            </div>
            <div>
              <h1 className="text-[#FFF4E0] font-extrabold text-lg leading-none">Carameli</h1>
              <p className="text-[#FFD275] text-xs font-medium opacity-70">VoiceGateway</p>
            </div>
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
                `flex items-center gap-3 px-4 py-3 rounded-[16px] font-medium text-sm transition-all duration-[250ms] ${
                  isActive
                    ? 'text-[#1A0F00]'
                    : 'text-[rgba(255,244,224,0.6)] hover:text-[#FFF4E0]'
                }`
              }
              style={({ isActive }) =>
                isActive
                  ? {
                      background: 'linear-gradient(to right, #FF9F1C, #E68A00)',
                      boxShadow: '0 4px 12px -2px rgba(255, 159, 28, 0.35)',
                    }
                  : { background: 'transparent' }
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
            <span className="text-[#FFD275] text-xs font-medium">API Online</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  )
}
