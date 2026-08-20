import type { UseSoftphoneResult } from '../../../hooks/useSoftphone'
import { DIALPAD_ROWS, callLabel, canHangup, statusLabel } from '../../../lib/softphone'

const ACCENT = { '--cb-accent': 'var(--cb-red)' } as React.CSSProperties

export default function Softphone(props: UseSoftphoneResult) {
    const {
        extensions,
        selectedId,
        select,
        status,
        callStatus,
        remoteParty,
        registeredAs,
        dialTarget,
        setDialTarget,
        muted,
        error,
        busy,
        connect,
        rotateCredential,
        disconnect,
        dial,
        answer,
        decline,
        hangup,
        toggleMute,
        pressDigit,
    } = props
    const registered = status === 'registered'

    return (
        <div style={{ padding: 24, paddingLeft: 216 }}>
            <h1 className="cb-title" style={{ marginBottom: 16 }}>Softphone</h1>

            {/* Registration */}
            <div className="cb-card" style={{ maxWidth: 460, padding: 16, marginBottom: 24 }}>
                <div className="cb-card-accent-bar" style={{ background: 'var(--cb-red)' }} />
                <div style={{ marginTop: 12 }}>
                    <span className="cb-label" style={ACCENT}>
                        {statusLabel(status)}
                        {registeredAs && ` — ${registeredAs}`}
                    </span>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                        aria-label="Extension"
                        className="cb-input"
                        value={selectedId}
                        onChange={e => select(e.target.value)}
                        disabled={registered}
                        style={{ width: 200 }}
                    >
                        <option value="">Pick an ext.</option>
                        {extensions.map(ext => (
                            <option key={ext.id} value={ext.id}>
                                {ext.extension_number} — {ext.sip_username}
                            </option>
                        ))}
                    </select>
                    <button
                        className="cb-button"
                        style={ACCENT}
                        onClick={registered ? disconnect : connect}
                        disabled={busy || (!registered && !selectedId)}
                    >
                        {registered ? 'Unregister' : busy ? 'Registering...' : 'Register'}
                    </button>
                    <button
                        className="cb-button"
                        style={ACCENT}
                        onClick={rotateCredential}
                        disabled={busy || !selectedId}
                        title="Mint a new SIP password; any other client holding the old one stops registering"
                    >
                        New password
                    </button>
                </div>
                {error && <p className="cb-error" style={{ marginTop: 8 }}>{error}</p>}
            </div>

            {/* Dial */}
            <div className="cb-card" style={{ maxWidth: 300, padding: 16, marginBottom: 24 }}>
                <div className="cb-card-accent-bar" style={{ background: 'var(--cb-red)' }} />
                <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                        aria-label="Number to dial"
                        className="cb-input"
                        type="text"
                        placeholder="+15145550100"
                        value={dialTarget}
                        onChange={e => setDialTarget(e.target.value)}
                        style={{ width: 150 }}
                    />
                    <button
                        className="cb-button"
                        style={ACCENT}
                        onClick={dial}
                        disabled={!registered || !dialTarget.trim()}
                    >
                        Call
                    </button>
                </div>
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 56px)', gap: 6 }}>
                    {DIALPAD_ROWS.flatMap(row => row).map(key => (
                        <button
                            key={key}
                            className="cb-button"
                            style={ACCENT}
                            onClick={() => pressDigit(key)}
                        >
                            {key}
                        </button>
                    ))}
                </div>
            </div>

            {/* Call */}
            <div className="cb-card" style={{ maxWidth: 400, padding: 16 }}>
                <div className="cb-card-accent-bar" style={{ background: 'var(--cb-red)' }} />
                <div style={{ marginTop: 12 }}>
                    <span className="cb-label" style={ACCENT}>{callLabel(callStatus, remoteParty)}</span>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {callStatus === 'ringing' && (
                        <>
                            <button className="cb-button" style={ACCENT} onClick={answer}>Answer</button>
                            <button className="cb-button" style={ACCENT} onClick={decline}>Decline</button>
                        </>
                    )}
                    {canHangup(callStatus) && (
                        <>
                            <button className="cb-button" style={ACCENT} onClick={hangup}>Hang up</button>
                            <button className="cb-button" style={ACCENT} onClick={toggleMute}>
                                {muted ? 'Unmute' : 'Mute'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
