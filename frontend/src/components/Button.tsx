import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
  size?: 'sm' | 'md'
  children: React.ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center gap-2 font-bold transition-all duration-[250ms] select-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'

  const sizeClass = size === 'sm' ? 'px-4 py-2 text-sm rounded-[16px]' : 'px-6 py-3 text-base rounded-[20px]'

  if (variant === 'ghost') {
    return (
      <button
        className={`${base} ${sizeClass} text-[#FFD275] hover:text-[#FFF4E0] ${className}`}
        style={{
          background: 'rgba(255,159,28,0.08)',
          border: '1px solid rgba(255,244,224,0.1)',
          transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onMouseDown={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.97)'
        }}
        onMouseUp={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
        }}
        {...props}
      >
        {children}
      </button>
    )
  }

  return (
    <button
      className={`${base} ${sizeClass} text-[#1A0F00] ${className}`}
      style={{
        background: 'linear-gradient(to bottom right, #FF9F1C, #E68A00)',
        boxShadow:
          '0 4px 15px -2px rgba(255, 159, 28, 0.4), inset 0 1px 0 rgba(255, 244, 224, 0.2)',
        transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onMouseDown={(e) => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.transform = 'scale(0.97)'
        el.style.boxShadow = 'inset 0 3px 8px rgba(26, 15, 0, 0.5)'
      }}
      onMouseUp={(e) => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.transform = 'scale(1)'
        el.style.boxShadow =
          '0 4px 15px -2px rgba(255, 159, 28, 0.4), inset 0 1px 0 rgba(255, 244, 224, 0.2)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.transform = 'scale(1)'
        el.style.boxShadow =
          '0 4px 15px -2px rgba(255, 159, 28, 0.4), inset 0 1px 0 rgba(255, 244, 224, 0.2)'
      }}
      {...props}
    >
      {children}
    </button>
  )
}
