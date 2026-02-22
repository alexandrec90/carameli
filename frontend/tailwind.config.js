/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        // Glass surface ambient glow — organic candle-like flicker (no structural shadow)
        candleflicker: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(255,159,28,0.12), 0 0 45px rgba(255,159,28,0.06)' },
          '15%':       { boxShadow: '0 0 26px rgba(255,159,28,0.18), 0 0 55px rgba(255,159,28,0.09)' },
          '30%':       { boxShadow: '0 0 17px rgba(255,159,28,0.10), 0 0 38px rgba(255,159,28,0.05)' },
          '50%':       { boxShadow: '0 0 30px rgba(255,159,28,0.22), 0 0 60px rgba(255,159,28,0.11)' },
          '70%':       { boxShadow: '0 0 15px rgba(255,159,28,0.08), 0 0 32px rgba(255,159,28,0.04)' },
          '85%':       { boxShadow: '0 0 24px rgba(255,159,28,0.16), 0 0 50px rgba(255,159,28,0.08)' },
        },
        // Card glass flicker — includes structural drop-shadow so it stays "static" to the eye
        'candleflicker-card': {
          '0%, 100%': { boxShadow: '0 10px 30px -5px rgba(26,15,0,0.5), 0 0 20px rgba(255,159,28,0.12), 0 0 45px rgba(255,159,28,0.06)' },
          '15%':       { boxShadow: '0 10px 30px -5px rgba(26,15,0,0.5), 0 0 26px rgba(255,159,28,0.18), 0 0 55px rgba(255,159,28,0.09)' },
          '30%':       { boxShadow: '0 10px 30px -5px rgba(26,15,0,0.5), 0 0 17px rgba(255,159,28,0.10), 0 0 38px rgba(255,159,28,0.05)' },
          '50%':       { boxShadow: '0 10px 30px -5px rgba(26,15,0,0.5), 0 0 30px rgba(255,159,28,0.22), 0 0 60px rgba(255,159,28,0.11)' },
          '70%':       { boxShadow: '0 10px 30px -5px rgba(26,15,0,0.5), 0 0 15px rgba(255,159,28,0.08), 0 0 32px rgba(255,159,28,0.04)' },
          '85%':       { boxShadow: '0 10px 30px -5px rgba(26,15,0,0.5), 0 0 24px rgba(255,159,28,0.16), 0 0 50px rgba(255,159,28,0.08)' },
        },
        // SVG arc / gauge draw-in
        'arc-draw': {
          from: { strokeDashoffset: 'var(--arc-total)' },
          to:   { strokeDashoffset: 'var(--arc-offset)' },
        },
        // Bar chart grow from baseline
        'bar-grow': {
          from: { transform: 'scaleY(0)' },
          to:   { transform: 'scaleY(1)' },
        },
      },
      animation: {
        candleflicker:        'candleflicker 4s cubic-bezier(0.4,0,0.2,1) infinite',
        'candleflicker-card': 'candleflicker-card 4s cubic-bezier(0.4,0,0.2,1) infinite',
        'arc-draw':           'arc-draw 800ms cubic-bezier(0.4,0,0.2,1) forwards',
        'bar-grow':           'bar-grow 800ms cubic-bezier(0.4,0,0.2,1) forwards',
      },
    },
  },
  plugins: [],
}
