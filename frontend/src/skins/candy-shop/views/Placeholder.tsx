import { motion } from 'framer-motion'
import type { PlaceholderProps } from '../../types'

export default function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="relative overflow-hidden text-center"
        style={{
          background: '#F5E6CC',
          borderRadius: '32px',
          boxShadow: 'inset 0 4px 10px rgba(255,255,255,0.5), 0 8px 24px rgba(92,51,23,0.2)',
          padding: '2.5rem 3rem',
          maxWidth: 480,
          width: '100%',
        }}
      >
        {/* Drip overlay */}
        <svg
          viewBox="0 0 480 80"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute top-0 left-0 w-full pointer-events-none"
          style={{ zIndex: 1 }}
          preserveAspectRatio="none"
        >
          <path
            d="
              M0,0 L480,0 L480,30
              C440,30 440,68 400,68
              C360,68 360,18 320,18
              C280,18 280,62 240,62
              C200,62 200,12 160,12
              C120,12 120,58 80,58
              C40,58 40,22 0,22 Z
            "
            fill="#C15A10"
            opacity="0.85"
          />
        </svg>

        <div className="relative" style={{ zIndex: 2, paddingTop: '2.5rem' }}>
          <h1
            className="text-3xl font-bold"
            style={{
              color: '#5C3317',
              textShadow: '1px 1px 0px #E8D09E',
              fontFamily: "'Pacifico', cursive",
            }}
          >
            {title}
          </h1>
          <p className="mt-3 text-base" style={{ color: '#8B4513' }}>
            {description}
          </p>
        </div>
      </motion.div>
    </div>
  )
}
