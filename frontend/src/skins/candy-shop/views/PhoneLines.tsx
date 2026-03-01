import { motion } from 'framer-motion'
import type { UsePhoneLinesResult } from '../../../hooks/usePhoneLines'

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

function CandyCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: '#F5E6CC',
        borderRadius: '32px',
        boxShadow: 'inset 0 4px 10px rgba(255,255,255,0.5), 0 8px 24px rgba(92,51,23,0.2)',
      }}
    >
      <DrippingOverlay />
      <div className="relative pt-16 px-6 pb-6" style={{ zIndex: 2 }}>
        {children}
      </div>
    </div>
  )
}

function LineRow({
  number,
  onDeactivate,
}: {
  number: string
  onDeactivate: () => void
}) {
  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 20px rgba(92,51,23,0.2)' }}
      transition={{ type: 'spring', stiffness: 250, damping: 18 }}
      className="flex items-center justify-between px-5 py-3 rounded-2xl"
      style={{
        background: 'linear-gradient(135deg, #FFF8E7, #E8D09E)',
        boxShadow: 'inset 0 2px 6px rgba(255,255,255,0.6), 0 2px 8px rgba(92,51,23,0.1)',
      }}
    >
      <span className="font-bold" style={{ color: '#5C3317' }}>
        {number}
      </span>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        onClick={onDeactivate}
        className="px-3 py-1 text-xs font-bold rounded-full"
        style={{
          background: 'linear-gradient(135deg, #C15A10, #E8A04A)',
          color: '#FFF8E7',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Deactivate
      </motion.button>
    </motion.div>
  )
}

export default function PhoneLines({
  lines,
  loading,
  areaCode,
  setAreaCode,
  adding,
  error,
  addLine,
  deactivate,
}: UsePhoneLinesResult) {
  return (
    <div className="space-y-8">
      <h1
        className="text-4xl font-bold"
        style={{
          color: '#5C3317',
          textShadow: '1px 1px 0px #E8D09E',
          fontFamily: "'Pacifico', cursive",
        }}
      >
        Phone Lines
      </h1>

      {/* Add line card */}
      <CandyCard>
        <h2 className="text-lg font-bold mb-4" style={{ color: '#5C3317' }}>
          Provision a New Number
        </h2>
        <div className="flex gap-3 items-start flex-wrap">
          <input
            type="text"
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value)}
            placeholder="Area code (e.g. 415)"
            maxLength={3}
            className="px-4 py-2 text-sm font-medium rounded-full outline-none"
            style={{
              background: 'linear-gradient(135deg, #FFF8E7, #E8D09E)',
              border: '2px solid #C15A10',
              color: '#5C3317',
              boxShadow: 'inset 0 2px 6px rgba(255,255,255,0.5)',
            }}
          />
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            onClick={addLine}
            disabled={adding}
            className="px-5 py-2 text-sm font-bold rounded-full"
            style={{
              background: adding
                ? '#E8D09E'
                : 'linear-gradient(135deg, #C15A10, #E8A04A)',
              color: adding ? '#8B4513' : '#FFF8E7',
              border: 'none',
              cursor: adding ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 12px rgba(193,90,16,0.3)',
            }}
          >
            {adding ? 'Adding…' : '+ Add Line'}
          </motion.button>
        </div>
        {error && (
          <p className="mt-3 text-sm font-medium" style={{ color: '#C15A10' }}>
            {error}
          </p>
        )}
      </CandyCard>

      {/* Lines list card */}
      <CandyCard>
        <h2 className="text-lg font-bold mb-4" style={{ color: '#5C3317' }}>
          Active Lines
        </h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: '4px solid #E8D09E',
                borderTopColor: '#C15A10',
              }}
            />
          </div>
        ) : lines.length === 0 ? (
          <p className="text-sm" style={{ color: '#8B4513' }}>
            No phone lines provisioned yet.
          </p>
        ) : (
          <div className="space-y-3">
            {lines.map((line) => (
              <LineRow
                key={line.phone_number}
                number={line.phone_number}
                onDeactivate={() => deactivate(line.phone_number)}
              />
            ))}
          </div>
        )}
      </CandyCard>
    </div>
  )
}
