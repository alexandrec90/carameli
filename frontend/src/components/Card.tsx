import React, { useEffect, useRef, useState } from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`rounded-[32px] p-6 glass-panel ${className}`}>
      {children}
    </div>
  )
}

// Animates a number from 0 to `target` using requestAnimationFrame.
// Triggers when `active` flips from false → true (i.e. when data finishes loading).
function useCountUp(target: number, duration: number, active: boolean): number {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    if (!active) {
      setDisplay(0)
      return
    }
    if (target === 0) {
      setDisplay(0)
      return
    }
    setDisplay(0)
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      // Approximate cubic-bezier(0.4, 0, 0.2, 1)
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
      setDisplay(Math.round(eased * target))
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration, active])

  return display
}

interface StatCardProps {
  label: string
  value: string | number
  icon: React.ReactNode
  loading?: boolean
}

export function StatCard({ label, value, icon, loading = false }: StatCardProps) {
  const isNumber = typeof value === 'number'
  const animated = useCountUp(isNumber ? (value as number) : 0, 1200, !loading && isNumber)

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="stat-label mb-1">{label}</p>
          {loading ? (
            <div className="shimmer h-8 w-24 rounded-[8px]" />
          ) : (
            <p className="stat-value text-3xl">
              {isNumber ? animated : value}
            </p>
          )}
        </div>
        <div className="text-[#FF9F1C] opacity-80">{icon}</div>
      </div>
    </Card>
  )
}
