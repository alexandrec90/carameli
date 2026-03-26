import { useNavigate, useLocation } from 'react-router-dom'
import type { LayoutProps } from '../types'
import type { NavItem } from '../../routes'

function Sidebar({ navItems }: { navItems: NavItem[] }) {
    const navigate = useNavigate()
    const location = useLocation()

    return (
        <nav
            style={{
                width: 160,
                flexShrink: 0,
                background: '#f5f5f5',
                borderRight: '1px solid #cccccc',
                display: 'flex',
                flexDirection: 'column',
                paddingTop: 8,
            }}
        >
            {navItems.map(({ label, path }) => {
                const active = location.pathname === path
                return (
                    <button
                        key={path}
                        onClick={() => navigate(path)}
                        style={{
                            display: 'block',
                            width: '100%',
                            padding: '8px 12px',
                            textAlign: 'left',
                            border: 'none',
                            borderBottom: '1px solid #e0e0e0',
                            background: active ? '#e8e8e8' : 'transparent',
                            color: active ? '#0057b8' : '#111111',
                            fontWeight: active ? 'bold' : 'normal',
                            fontFamily: 'system-ui, sans-serif',
                            fontSize: 14,
                            cursor: 'pointer',
                        }}
                    >
                        {label}
                    </button>
                )
            })}
        </nav>
    )
}

export function Layout({ children, navItems }: LayoutProps) {
    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                fontFamily: 'system-ui, sans-serif',
                color: '#111111',
                background: '#ffffff',
            }}
        >
            {/* Header */}
            <header
                style={{
                    height: 40,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 16px',
                    borderBottom: '1px solid #cccccc',
                    background: '#ffffff',
                    flexShrink: 0,
                }}
            >
                <strong style={{ fontSize: 15 }}>Carameli</strong>
                <span style={{ marginLeft: 8, fontSize: 11, color: '#666666' }}>barebone skin</span>
            </header>

            {/* Body */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <Sidebar navItems={navItems} />
                <main
                    style={{
                        flex: 1,
                        padding: 16,
                        overflowY: 'auto',
                    }}
                >
                    {children}
                </main>
            </div>
        </div>
    )
}
