import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div
      className={`rounded-[32px] p-6 ${className}`}
      style={{
        background: 'rgba(26, 15, 0, 0.55)',
        backdropFilter: 'blur(25px)',
        WebkitBackdropFilter: 'blur(25px)',
        borderTop: '1px solid rgba(255, 244, 224, 0.15)',
        borderLeft: '1px solid rgba(255, 244, 224, 0.15)',
        borderBottom: '1px solid rgba(255, 244, 224, 0.04)',
        borderRight: '1px solid rgba(255, 244, 224, 0.04)',
        boxShadow: '0 10px 30px -5px rgba(26, 15, 0, 0.5)',
      }}
    >
      {children}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number
  icon: React.ReactNode
  loading?: boolean
}

export function StatCard({ label, value, icon, loading = false }: StatCardProps) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[#FFD275] text-sm font-medium mb-1">{label}</p>
          {loading ? (
            <div
              className="shimmer h-8 w-24 rounded-[8px]"
            />
          ) : (
            <p className="text-[#FFF4E0] text-3xl font-extrabold">{value}</p>
          )}
        </div>
        <div className="text-[#FF9F1C] opacity-80">{icon}</div>
      </div>
    </Card>
  )
}
