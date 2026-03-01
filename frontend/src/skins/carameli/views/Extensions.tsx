import { PhoneCall, Plus } from 'lucide-react'
import { Card } from '../../../components/Card'
import { Button } from '../../../components/Button'
import type { UseExtensionsResult } from '../../../hooks/useExtensions'

export default function ExtensionsView({
  available,
  extNumber,
  setExtNumber,
  adding,
  error,
  success,
  addExtension,
}: UseExtensionsResult) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title text-4xl font-extrabold">Extensions</h1>
        <p className="page-subtitle text-base font-medium mt-1">
          Manage SIP extensions and credentials
        </p>
      </div>

      {/* Add extension */}
      <Card>
        <h2 className="section-title font-bold text-lg mb-4">Create Extension</h2>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            type="text"
            placeholder="Extension number (e.g. 101)"
            value={extNumber}
            onChange={(e) => setExtNumber(e.target.value)}
            className="ui-input px-4 py-2.5 rounded-[16px] outline-none focus:ring-2 focus:ring-[#FF9F1C]/40 w-56"
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
        <p className="text-helper mt-3">
          Creates a Twilio SIP credential — requires valid Twilio credentials
        </p>
      </Card>

      {/* Available extensions */}
      <Card>
        <h2 className="section-title font-bold text-lg mb-4">
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
                className="ui-chip ui-button-label px-3 py-1.5 rounded-[10px] text-[#FFD275] hover:text-[#FFF4E0] transition-all duration-[250ms]"
                style={{
                  background: 'rgba(255,159,28,0.1)',
                  border: '1px solid rgba(255,244,224,0.08)',
                }}
              >
                {n}
              </button>
            ))}
            {available.available.length === 0 && (
              <p className="text-body-soft text-sm">All extensions in this range are in use</p>
            )}
          </div>
        )}
      </Card>

      {/* Info card */}
      <Card>
        <div className="flex gap-4">
          <PhoneCall size={24} className="text-[#FF9F1C] flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="section-title font-bold mb-1">SIP Credentials</h3>
            <p className="text-body-soft text-sm leading-relaxed">
              Each extension creates a Twilio SIP credential. Configure your SIP phone
              with the generated <code className="text-code-accent">sip_username</code> and the
              domain <code className="text-code-accent">vg-&lt;id&gt;.sip.twilio.com</code>.
              Passwords are auto-generated unless provided.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
