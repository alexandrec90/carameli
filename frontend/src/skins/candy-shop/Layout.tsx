import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'

// ─── Drip SVG ────────────────────────────────────────────────────────────────

function DripEdge() {
  return (
    <svg
      viewBox="0 0 1200 60"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute bottom-0 left-0 w-full"
      style={{ transform: 'translateY(100%)', pointerEvents: 'none' }}
      preserveAspectRatio="none"
    >
      <path
        d="
          M0,0
          C80,0 80,52 120,52 C160,52 160,0 220,0
          C280,0 280,58 330,58 C380,58 380,0 440,0
          C500,0 500,48 550,48 C600,48 600,0 660,0
          C720,0 720,56 770,56 C820,56 820,0 880,0
          C940,0 940,50 990,50 C1040,50 1040,0 1100,0
          C1150,0 1150,54 1200,54
          L1200,0 L0,0 Z
        "
        fill="#C15A10"
      />
      <path
        d="
          M0,0
          C80,0 80,52 120,52 C160,52 160,0 220,0
          C280,0 280,58 330,58 C380,58 380,0 440,0
          C500,0 500,48 550,48 C600,48 600,0 660,0
          C720,0 720,56 770,56 C820,56 820,0 880,0
          C940,0 940,50 990,50 C1040,50 1040,0 1100,0
          C1150,0 1150,54 1200,54
          L1200,4 L0,4 Z
        "
        fill="rgba(255,243,204,0.3)"
      />
    </svg>
  )
}

// ─── Nav items ───────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: '🏠' },
  { label: 'Phone Lines', path: '/phone-lines', icon: '📞' },
  { label: 'Extensions', path: '/extensions', icon: '🔌' },
  { label: 'Settings', path: '/settings', icon: '⚙️' },
]

function NavCircle({ label, path, icon }: { label: string; path: string; icon: string }) {
  const [hovered, setHovered] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const active = location.pathname === path

  return (
    <motion.div
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onClick={() => navigate(path)}
      animate={{ width: hovered ? '16rem' : '6rem' }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="cursor-pointer overflow-hidden flex items-center justify-center gap-3"
      style={{
        height: '6rem',
        borderRadius: '9999px',
        border: `4px solid ${active ? '#C15A10' : '#5C3317'}`,
        background: active
          ? 'linear-gradient(135deg, #C15A10, #E8A04A)'
          : 'linear-gradient(135deg, #FFF8E7, #E8D09E)',
        boxShadow: active
          ? '0 4px 16px rgba(193,90,16,0.4), inset 0 2px 8px rgba(255,243,204,0.5)'
          : '0 4px 12px rgba(92,51,23,0.2), inset 0 2px 6px rgba(255,255,255,0.6)',
        flexShrink: 0,
      }}
    >
      <span className="text-2xl flex-shrink-0">{icon}</span>
      <AnimatePresence>
        {hovered && (
          <motion.span
            key="label"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.15 }}
            className="font-bold whitespace-nowrap text-base"
            style={{ color: active ? '#FFF8E7' : '#5C3317' }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Logo ─────────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div className="relative select-none">
      {/* Shadow layer */}
      <span
        className="absolute inset-0 text-5xl font-bold"
        style={{
          fontFamily: "'Pacifico', 'Comic Sans MS', cursive",
          color: '#8B4513',
          filter: 'blur(4px)',
          opacity: 0.5,
          transform: 'translate(3px, 5px)',
        }}
        aria-hidden
      >
        Carameli
      </span>
      {/* Gradient text */}
      <span
        className="relative text-5xl font-bold"
        style={{
          fontFamily: "'Pacifico', 'Comic Sans MS', cursive",
          backgroundImage: 'linear-gradient(to bottom, #FFFFFF, #FFD37E)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        Carameli
      </span>
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header() {
  return (
    <div className="sticky top-0 z-50">
      {/* Caramel pour body */}
      <div
        className="relative px-8 pt-6 pb-16"
        style={{
          background: '#C15A10',
          borderBottom: '4px solid rgba(255,243,204,0.3)',
        }}
      >
        {/* Gloss overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(255,243,204,0.4) 0%, transparent 50%)',
            borderRadius: 'inherit',
          }}
        />
        <div className="relative flex items-center justify-between max-w-7xl mx-auto">
          <Logo />
          <nav className="flex items-center gap-4">
            {NAV_ITEMS.map((item) => (
              <NavCircle key={item.path} {...item} />
            ))}
          </nav>
        </div>

        {/* Drip edge */}
        <DripEdge />
      </div>
    </div>
  )
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen"
      style={{ background: 'linear-gradient(160deg, #FFF8E7 0%, #F0D9AE 100%)' }}
    >
      <Header />
      <main className="max-w-7xl mx-auto px-8 pt-20 pb-12">{children}</main>
    </div>
  )
}
