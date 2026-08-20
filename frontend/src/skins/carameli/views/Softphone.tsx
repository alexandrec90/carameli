import { Mic, MicOff, Phone, PhoneOff, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/Button'
import { Card } from '../../../components/Card'
import type { UseSoftphoneResult } from '../../../hooks/useSoftphone'
import { DIALPAD_ROWS, callLabel, canHangup, statusLabel } from '../../../lib/softphone'

const STATUS_COLOR: Record<string, string> = {
  registered: '#22c55e',
  connecting: '#FF9F1C',
  failed: '#E8003D',
  offline: '#8a7a63',
}

export default function SoftphoneView({
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
    <div className="space-y-8">
      <div>
        <h1 className="page-title text-4xl font-extrabold">Softphone</h1>
        <p className="page-subtitle text-base font-medium mt-1">
          Register an extension in this browser — no desktop SIP client
        </p>
      </div>

      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h2 className="section-title font-bold text-lg">Registration</h2>
          <span className="flex items-center gap-2 text-sm" style={{ color: STATUS_COLOR[status] }}>
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: STATUS_COLOR[status] }}
            />
            {statusLabel(status)}
          </span>
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          <select
            aria-label="Extension"
            value={selectedId}
            onChange={(e) => select(e.target.value)}
            disabled={registered}
            className="ui-input px-4 py-2.5 rounded-[16px] outline-none w-72"
            style={{
              background: 'rgba(255,159,28,0.08)',
              border: '1px solid rgba(255,244,224,0.1)',
            }}
          >
            <option value="">Select an extension</option>
            {extensions.map((ext) => (
              <option key={ext.id} value={ext.id}>
                {ext.extension_number} — {ext.sip_username}
              </option>
            ))}
          </select>

          <Button
            size="sm"
            variant={registered ? 'ghost' : 'primary'}
            onClick={registered ? disconnect : connect}
            disabled={busy || (!registered && !selectedId)}
          >
            <Phone size={16} />
            {registered ? 'Unregister' : busy ? 'Registering…' : 'Register'}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={rotateCredential}
            disabled={busy || !selectedId}
            title="Mint a new SIP password — any other client holding the old one stops registering"
          >
            <RefreshCw size={16} />
            New password
          </Button>
        </div>

        {registeredAs && (
          <p className="text-helper mt-3">
            Registered as <code className="text-code-accent">{registeredAs}</code>
          </p>
        )}
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      </Card>

      <div className="grid gap-8 lg:grid-cols-2">
        <Card>
          <h2 className="section-title font-bold text-lg mb-4">Dial</h2>
          <div className="flex gap-3 items-center flex-wrap">
            <input
              aria-label="Number to dial"
              type="text"
              placeholder="+15145550100 or 101"
              value={dialTarget}
              onChange={(e) => setDialTarget(e.target.value)}
              className="ui-input px-4 py-2.5 rounded-[16px] outline-none w-56"
              style={{
                background: 'rgba(255,159,28,0.08)',
                border: '1px solid rgba(255,244,224,0.1)',
              }}
            />
            <Button size="sm" onClick={dial} disabled={!registered || !dialTarget.trim()}>
              <Phone size={16} />
              Call
            </Button>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2 max-w-[15rem]">
            {DIALPAD_ROWS.flatMap((row) => row).map((key) => (
              <button
                key={key}
                onClick={() => pressDigit(key)}
                className="ui-chip py-3 rounded-[14px] text-lg text-[#FFD275] hover:text-[#FFF4E0] transition-all duration-[250ms]"
                style={{
                  background: 'rgba(255,159,28,0.1)',
                  border: '1px solid rgba(255,244,224,0.08)',
                }}
              >
                {key}
              </button>
            ))}
          </div>
          <p className="text-helper mt-3">Keys send DTMF tones while a call is up.</p>
        </Card>

        <Card>
          <h2 className="section-title font-bold text-lg mb-4">Call</h2>
          <p className="text-body-soft text-sm mb-4">{callLabel(callStatus, remoteParty)}</p>
          <div className="flex gap-3 flex-wrap">
            {callStatus === 'ringing' && (
              <>
                <Button size="sm" onClick={answer}>
                  <Phone size={16} />
                  Answer
                </Button>
                <Button size="sm" variant="danger" onClick={decline}>
                  <PhoneOff size={16} />
                  Decline
                </Button>
              </>
            )}
            {canHangup(callStatus) && (
              <>
                <Button size="sm" variant="danger" onClick={hangup}>
                  <PhoneOff size={16} />
                  Hang up
                </Button>
                <Button size="sm" variant="ghost" onClick={toggleMute}>
                  {muted ? <MicOff size={16} /> : <Mic size={16} />}
                  {muted ? 'Unmute' : 'Mute'}
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
