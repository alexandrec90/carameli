import { motion } from 'framer-motion'
import type { UseSoftphoneResult } from '../../../hooks/useSoftphone'
import { DIALPAD_ROWS, callLabel, canHangup, statusLabel } from '../../../lib/softphone'

function CandyCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative overflow-hidden p-6"
      style={{
        background: '#F5E6CC',
        borderRadius: '32px',
        boxShadow: 'inset 0 4px 10px rgba(255,255,255,0.5), 0 8px 24px rgba(92,51,23,0.2)',
      }}
    >
      {children}
    </div>
  )
}

const FIELD = {
  background: 'linear-gradient(135deg, #FFF8E7, #E8D09E)',
  border: '2px solid #8B4513',
  color: '#5C3317',
  boxShadow: 'inset 0 2px 6px rgba(255,255,255,0.5)',
}

function Sweet({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.04 }}
      whileTap={{ scale: disabled ? 1 : 0.95 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-5 py-2 text-sm font-bold rounded-full"
      style={{
        background: disabled ? '#E8D09E' : 'linear-gradient(135deg, #C15A10, #E8A04A)',
        color: disabled ? '#8B4513' : '#FFF8E7',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: '0 4px 12px rgba(193,90,16,0.3)',
      }}
    >
      {children}
    </motion.button>
  )
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
    <div className="space-y-8">
      <h1
        className="text-4xl font-bold"
        style={{
          color: '#5C3317',
          textShadow: '1px 1px 0px #E8D09E',
          fontFamily: "'Pacifico', cursive",
        }}
      >
        Softphone
      </h1>

      <CandyCard>
        <h2 className="text-lg font-bold mb-4" style={{ color: '#5C3317' }}>
          {statusLabel(status)}
          {registeredAs && ` — ${registeredAs}`}
        </h2>
        <div className="flex gap-3 items-center flex-wrap">
          <select
            aria-label="Extension"
            value={selectedId}
            onChange={(e) => select(e.target.value)}
            disabled={registered}
            className="px-4 py-2 text-sm font-medium rounded-full outline-none"
            style={FIELD}
          >
            <option value="">Pick an extension</option>
            {extensions.map((ext) => (
              <option key={ext.id} value={ext.id}>
                {ext.extension_number} — {ext.sip_username}
              </option>
            ))}
          </select>
          <Sweet
            onClick={registered ? disconnect : connect}
            disabled={busy || (!registered && !selectedId)}
          >
            {registered ? 'Unregister' : busy ? 'Registering…' : 'Register'}
          </Sweet>
          <Sweet
            onClick={rotateCredential}
            disabled={busy || !selectedId}
            title="Mint a new SIP password; any other client holding the old one stops registering"
          >
            New password
          </Sweet>
        </div>
        {error && (
          <p className="mt-3 text-sm font-medium" style={{ color: '#C15A10' }}>
            {error}
          </p>
        )}
      </CandyCard>

      <CandyCard>
        <h2 className="text-lg font-bold mb-4" style={{ color: '#5C3317' }}>
          Dial
        </h2>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            aria-label="Number to dial"
            type="text"
            value={dialTarget}
            onChange={(e) => setDialTarget(e.target.value)}
            placeholder="+15145550100 or 101"
            className="px-4 py-2 text-sm font-medium rounded-full outline-none"
            style={FIELD}
          />
          <Sweet onClick={dial} disabled={!registered || !dialTarget.trim()}>
            Call
          </Sweet>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 max-w-[15rem]">
          {DIALPAD_ROWS.flatMap((row) => row).map((key) => (
            <motion.button
              key={key}
              whileHover={{ scale: 1.08, y: -2 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              onClick={() => pressDigit(key)}
              className="py-3 font-bold rounded-full"
              style={{ ...FIELD, cursor: 'pointer' }}
            >
              {key}
            </motion.button>
          ))}
        </div>
      </CandyCard>

      <CandyCard>
        <h2 className="text-lg font-bold mb-4" style={{ color: '#5C3317' }}>
          {callLabel(callStatus, remoteParty)}
        </h2>
        <div className="flex gap-3 flex-wrap">
          {callStatus === 'ringing' && (
            <>
              <Sweet onClick={answer}>Answer</Sweet>
              <Sweet onClick={decline}>Decline</Sweet>
            </>
          )}
          {canHangup(callStatus) && (
            <>
              <Sweet onClick={hangup}>Hang up</Sweet>
              <Sweet onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</Sweet>
            </>
          )}
        </div>
      </CandyCard>
    </div>
  )
}
