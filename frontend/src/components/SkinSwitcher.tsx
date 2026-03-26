import { useSkinSwitcher } from '../skins/context'
import type { SkinName } from '../skins/registry'

const SKIN_LABELS: Record<SkinName, string> = {
  carameli: 'Carameli',
  'candy-shop': 'Candy Shop',
  barebone: 'Barebone',
}

export function SkinSwitcher() {
  const { skinName, switchSkin, skinNames } = useSkinSwitcher()

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        zIndex: 9999,
        display: 'flex',
        gap: '4px',
        padding: '5px',
        borderRadius: '14px',
        background: 'rgba(26, 15, 0, 0.8)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,159,28,0.25)',
      }}
    >
      {skinNames.map((name) => (
        <button
          key={name}
          onClick={() => name !== skinName && switchSkin(name)}
          style={{
            padding: '5px 13px',
            borderRadius: '9px',
            border: 'none',
            cursor: name === skinName ? 'default' : 'pointer',
            fontWeight: 600,
            fontSize: '12px',
            letterSpacing: '0.02em',
            transition: 'all 180ms ease',
            background:
              name === skinName
                ? 'linear-gradient(to right, #FF9F1C, #E68A00)'
                : 'transparent',
            color: name === skinName ? '#1A0F00' : 'rgba(255,244,224,0.55)',
          }}
        >
          {SKIN_LABELS[name]}
        </button>
      ))}
    </div>
  )
}
