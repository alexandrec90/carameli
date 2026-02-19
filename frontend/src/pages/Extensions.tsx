import { useEffect, useState } from 'react'
import { PhoneCall, Plus } from 'lucide-react'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { api } from '../api/client'

const CUSTOMER_ID = 1

interface AvailableExt {
  available: string[]
  vs_customer_id: number
}

export default function Extensions() {
  const [available, setAvailable] = useState<AvailableExt | null>(null)
  const [extNumber, setExtNumber] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    api.extensions
      .getAvailable(CUSTOMER_ID, 100, 199)
      .then(setAvailable)
      .catch(() => {})
  }, [])

  async function addExtension() {
    if (!extNumber.trim()) return
    setAdding(true)
    setError('')
    setSuccess('')
    try {
      const ext = await api.extensions.add({
        vs_customer_id: CUSTOMER_ID,
        extension_number: extNumber.trim(),
      })
      setSuccess(`Extension ${ext.extension_number} created. SIP: ${ext.sip_username}`)
      setExtNumber('')
      const upd = await api.extensions.getAvailable(CUSTOMER_ID, 100, 199)
      setAvailable(upd)
    } catch (e) {
      setError(String(e))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[#FFF4E0] text-4xl font-extrabold">Extensions</h1>
        <p className="text-[rgba(255,244,224,0.6)] text-base font-medium mt-1">
          Manage SIP extensions and credentials
        </p>
      </div>

      {/* Add extension */}
      <Card>
        <h2 className="text-[#FFF4E0] font-bold text-lg mb-4">Create Extension</h2>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            type="text"
            placeholder="Extension number (e.g. 101)"
            value={extNumber}
            onChange={(e) => setExtNumber(e.target.value)}
            className="px-4 py-2.5 rounded-[16px] text-[#FFF4E0] placeholder-[rgba(255,244,224,0.3)] font-medium text-sm outline-none focus:ring-2 focus:ring-[#FF9F1C]/40 w-56"
            style={{
              background: 'rgba(255,159,28,0.08)',
              border: '1px solid rgba(255,244,224,0.1)',
              transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
          <Button size="sm" onClick={addExtension} disabled={adding || !extNumber.trim()}>
            <Plus size={16} />
            {adding ? 'Creating…' : 'Create Extension'}
          </Button>
        </div>
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        {success && <p className="text-green-400 text-sm mt-3">{success}</p>}
        <p className="text-[rgba(255,244,224,0.35)] text-xs mt-3">
          Creates a Twilio SIP credential — requires valid Twilio credentials
        </p>
      </Card>

      {/* Available extensions */}
      <Card>
        <h2 className="text-[#FFF4E0] font-bold text-lg mb-4">
          Available in Range 100–199
        </h2>
        {!available ? (
          <div className="shimmer h-20 rounded-[12px]" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.available.slice(0, 30).map((n) => (
              <button
                key={n}
                onClick={() => setExtNumber(n)}
                className="px-3 py-1.5 rounded-[10px] text-[#FFD275] text-sm font-medium hover:text-[#FFF4E0] transition-all duration-[250ms]"
                style={{
                  background: 'rgba(255,159,28,0.1)',
                  border: '1px solid rgba(255,244,224,0.08)',
                }}
              >
                {n}
              </button>
            ))}
            {available.available.length === 0 && (
              <p className="text-[rgba(255,244,224,0.4)] text-sm">All extensions in this range are in use</p>
            )}
          </div>
        )}
      </Card>

      {/* Info card */}
      <Card>
        <div className="flex gap-4">
          <PhoneCall size={24} className="text-[#FF9F1C] flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-[#FFF4E0] font-bold mb-1">SIP Credentials</h3>
            <p className="text-[rgba(255,244,224,0.6)] text-sm leading-relaxed">
              Each extension creates a Twilio SIP credential. Configure your SIP phone
              with the generated <code className="text-[#FFD275]">sip_username</code> and the
              domain <code className="text-[#FFD275]">vg-&lt;id&gt;.sip.twilio.com</code>.
              Passwords are auto-generated unless provided.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
