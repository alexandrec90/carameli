import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger'
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
    'inline-flex items-center gap-2 ui-button-label select-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'

  const sizeClass = size === 'sm' ? 'px-4 py-2 text-sm rounded-[16px]' : 'px-6 py-3 text-base rounded-[20px]'

  if (variant === 'ghost') {
    return (
      <button
        className={`${base} ${sizeClass} btn-ghost text-[#FFD275] hover:text-[#FFF4E0] ${className}`}
        style={{
          background: 'rgba(255,159,28,0.08)',
          border: '1px solid rgba(255,244,224,0.1)',
        }}
        {...props}
      >
        {children}
      </button>
    )
  }

  if (variant === 'danger') {
    return (
      <button
        className={`${base} ${sizeClass} btn-danger text-[#FFF4E0] ${className}`}
        style={{
          background: 'linear-gradient(to bottom right, #E8003D, #B00030)',
        }}
        {...props}
      >
        {children}
      </button>
    )
  }

  return (
    <button
      className={`${base} ${sizeClass} btn-primary text-[#1A0F00] ${className}`}
      style={{
        background: 'linear-gradient(to bottom right, #FF9F1C, #E68A00)',
      }}
      {...props}
    >
      {children}
    </button>
  )
}
