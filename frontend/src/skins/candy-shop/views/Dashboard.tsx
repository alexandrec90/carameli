import { motion } from 'framer-motion'
import type { UseDashboardResult } from '../../../hooks/useDashboard'

// ─── Shared primitives ───────────────────────────────────────────────────────

function DrippingOverlay({ color = '#C15A10' }: { color?: string }) {
  return (
    <svg
      viewBox="0 0 400 80"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute top-0 left-0 w-full pointer-events-none"
      style={{ zIndex: 1 }}
      preserveAspectRatio="none"
    >
      <path
        d="
          M0,0 L400,0 L400,30
          C360,30 360,70 320,70
          C280,70 280,20 240,20
          C200,20 200,65 160,65
          C120,65 120,15 80,15
          C40,15 40,60 0,60 Z
        "
        fill={color}
        opacity="0.85"
      />
    </svg>
  )
}

function CandyCard({
  children,
  className = '',
  dripColor,
}: {
  children: React.ReactNode
  className?: string
  dripColor?: string
}) {
  return (
    <motion.div
      whileHover={{ y: -4, boxShadow: 'inset 0 4px 10px rgba(255,255,255,0.5), 0 16px 40px rgba(92,51,23,0.3)' }}
      transition={{ type: 'spring', stiffness: 250, damping: 18 }}
      className={`relative overflow-hidden ${className}`}
      style={{
        background: '#F5E6CC',
        borderRadius: '32px',
        boxShadow: 'inset 0 4px 10px rgba(255,255,255,0.5), 0 8px 24px rgba(92,51,23,0.2)',
      }}
    >
      <DrippingOverlay color={dripColor} />
      <div className="relative pt-16 px-6 pb-6" style={{ zIndex: 2 }}>
        {children}
      </div>
    </motion.div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ online }: { online: boolean | null }) {
  const label = online === null ? 'Checking…' : online ? 'Online' : 'Offline'
  const colors = online === null
    ? { bg: '#E8D09E', text: '#8B4513' }
    : online
    ? { bg: '#5C3317', text: '#FFD37E' }
    : { bg: '#C15A10', text: '#FFF8E7' }

  return (
    <span
      className="inline-block px-4 py-1 rounded-full text-sm font-bold"
      style={{ background: colors.bg, color: colors.text }}
    >
      {label}
    </span>
  )
}

// ─── Dashboard view ──────────────────────────────────────────────────────────

export default function Dashboard({
  customer,
  lineCount,
  apiOnline,
  loading,
  seedDemoCustomer,
}: UseDashboardResult) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: '4px solid #E8D09E',
            borderTopColor: '#C15A10',
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Page heading */}
      <div>
        <h1
          className="text-4xl font-bold"
          style={{
            color: '#5C3317',
            textShadow: '1px 1px 0px #E8D09E',
            fontFamily: "'Pacifico', cursive",
          }}
        >
          Dashboard
        </h1>
        <p className="mt-1 text-base" style={{ color: '#8B4513' }}>
          Welcome to your VoiceGateway command centre.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* API status */}
        <CandyCard dripColor="#C15A10">
          <p className="text-sm font-bold uppercase tracking-widest" style={{ color: '#8B4513' }}>
            API Status
          </p>
          <div className="mt-3">
            <StatusBadge online={apiOnline} />
          </div>
        </CandyCard>

        {/* Customer */}
        <CandyCard dripColor="#8B4513">
          <p className="text-sm font-bold uppercase tracking-widest" style={{ color: '#8B4513' }}>
            Customer
          </p>
          {customer ? (
            <p className="mt-3 text-xl font-bold" style={{ color: '#5C3317' }}>
              #{customer.vs_customer_id}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-sm" style={{ color: '#8B4513' }}>
                No customer seeded yet.
              </p>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                onClick={seedDemoCustomer}
                className="px-4 py-2 text-sm font-bold rounded-full"
                style={{
                  background: 'linear-gradient(135deg, #C15A10, #E8A04A)',
                  color: '#FFF8E7',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(193,90,16,0.3)',
                }}
              >
                Seed Demo Customer
              </motion.button>
            </div>
          )}
        </CandyCard>

        {/* Phone lines */}
        <CandyCard dripColor="#5C3317">
          <p className="text-sm font-bold uppercase tracking-widest" style={{ color: '#8B4513' }}>
            Phone Lines
          </p>
          <p className="mt-3 text-4xl font-bold" style={{ color: '#5C3317' }}>
            {lineCount}
          </p>
          <p className="mt-1 text-sm" style={{ color: '#8B4513' }}>
            active DIDs
          </p>
        </CandyCard>
      </div>
    </div>
  )
}
