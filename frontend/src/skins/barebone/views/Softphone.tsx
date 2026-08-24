import type { UseSoftphoneResult } from '../../../hooks/useSoftphone'
import { DIALPAD_ROWS, callLabel, canHangup, statusLabel } from '../../../lib/softphone'

const input = {
    border: '1px solid #cccccc',
    padding: '4px 8px',
    fontSize: 14,
    fontFamily: 'system-ui, sans-serif',
}

function button(primary: boolean, disabled: boolean) {
    return {
        border: `1px solid ${primary ? '#0057b8' : '#cccccc'}`,
        padding: '4px 12px',
        background: primary ? '#0057b8' : '#ffffff',
        color: primary ? '#ffffff' : '#000000',
        fontSize: 13,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
    }
}

export default function Softphone({
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
}: UseSoftphoneResult) {
    const registered = status === 'registered'

    return (
        <div>
            <h1 style={{ fontSize: 20, marginTop: 0 }}>Softphone</h1>

            <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16 }}>Registration</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                        value={selectedId}
                        onChange={(e) => select(e.target.value)}
                        disabled={registered}
                        style={input}
                        aria-label="Extension"
                    >
                        <option value="">Select an extension</option>
                        {extensions.map((ext) => (
                            <option key={ext.id} value={ext.id}>
                                {ext.extension_number} — {ext.sip_username}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={registered ? disconnect : connect}
                        disabled={busy || (!registered && !selectedId)}
                        style={button(!registered, busy || (!registered && !selectedId))}
                    >
                        {registered ? 'Unregister' : busy ? 'Registering…' : 'Register'}
                    </button>
                    <button
                        onClick={rotateCredential}
                        disabled={busy || !selectedId}
                        style={button(false, busy || !selectedId)}
                        title="Mint a new SIP password; any other client holding the old one stops registering"
                    >
                        New password
                    </button>
                </div>
                <p style={{ color: '#666666', fontSize: 13 }}>
                    {statusLabel(status)}
                    {registeredAs && ` as ${registeredAs}`}
                </p>
            </section>

            <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16 }}>Dial</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                        type="text"
                        placeholder="+15145550100 or 101"
                        value={dialTarget}
                        onChange={(e) => setDialTarget(e.target.value)}
                        style={input}
                        aria-label="Number to dial"
                    />
                    <button
                        onClick={dial}
                        disabled={!registered || !dialTarget.trim()}
                        style={button(true, !registered || !dialTarget.trim())}
                    >
                        Call
                    </button>
                </div>

                <div style={{ display: 'inline-block', marginTop: 12 }}>
                    {DIALPAD_ROWS.map((row) => (
                        <div key={row.join('')} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                            {row.map((key) => (
                                <button
                                    key={key}
                                    onClick={() => pressDigit(key)}
                                    style={{ ...button(false, false), width: 44, fontSize: 16 }}
                                >
                                    {key}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            </section>

            <section>
                <h2 style={{ fontSize: 16 }}>Call</h2>
                <p style={{ fontSize: 13, color: '#666666' }}>{callLabel(callStatus, remoteParty)}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                    {callStatus === 'ringing' && (
                        <>
                            <button onClick={answer} style={button(true, false)}>Answer</button>
                            <button onClick={decline} style={button(false, false)}>Decline</button>
                        </>
                    )}
                    {canHangup(callStatus) && (
                        <>
                            <button onClick={hangup} style={button(false, false)}>Hang up</button>
                            <button onClick={toggleMute} style={button(false, false)}>
                                {muted ? 'Unmute' : 'Mute'}
                            </button>
                        </>
                    )}
                </div>
                {error && <p style={{ color: '#cc0000', fontSize: 13, marginTop: 8 }}>{error}</p>}
            </section>
        </div>
    )
}
