import React from 'react'
import { Phone, Plus, Trash2 } from 'lucide-react'
import { Card } from '../../../components/Card'
import { Button } from '../../../components/Button'
import type { UsePhoneLinesResult } from '../../../hooks/usePhoneLines'

export default function PhoneLinesView({
  lines,
  loading,
  areaCode,
  setAreaCode,
  adding,
  error,
  addLine,
  deactivate,
}: UsePhoneLinesResult) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title text-4xl font-extrabold">Phone Lines</h1>
        <p className="page-subtitle text-base font-medium mt-1">
          Manage DIDs (Direct Inward Dialing numbers)
        </p>
      </div>

      {/* Add line form */}
      <Card>
        <h2 className="section-title font-bold text-lg mb-4">Provision New DID</h2>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            type="text"
            placeholder="Area code (e.g. 415)"
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value)}
            maxLength={3}
            className="ui-input px-4 py-2.5 rounded-[16px] outline-none focus:ring-2 focus:ring-[#FF9F1C]/40 w-48"
            style={{
              background: 'rgba(255,159,28,0.08)',
              border: '1px solid rgba(255,244,224,0.1)',
              transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
          <Button size="sm" onClick={addLine} disabled={adding || !areaCode.trim()}>
            <Plus size={16} />
            {adding ? 'Provisioning…' : 'Add Line'}
          </Button>
        </div>
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        <p className="text-helper mt-3">
          Requires valid Twilio credentials in .env — uses real Twilio API
        </p>
      </Card>

      {/* Lines table */}
      <Card>
        <h2 className="section-title font-bold text-lg mb-4">
          Active Lines {!loading && <span className="text-[#FFD275]">({lines.length})</span>}
        </h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-12 rounded-[12px]" />
            ))}
          </div>
        ) : lines.length === 0 ? (
          <div className="text-center py-12">
            <Phone size={40} className="mx-auto mb-3 text-[rgba(255,159,28,0.3)]" />
            <p className="text-body-soft font-medium">No phone lines yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => (
              <div
                key={line.id}
                className="flex items-center justify-between rounded-[16px] px-5 py-3"
                style={{ background: 'rgba(255,159,28,0.06)', border: '1px solid rgba(255,244,224,0.05)' }}
              >
                <div className="flex items-center gap-4">
                  <Phone size={16} className="text-[#FF9F1C]" />
                  <span className="field-value">{line.phone_number}</span>
                </div>
                <div className="flex items-center gap-3">
                  {line.sms_enabled && <Badge>SMS</Badge>}
                  {line.recording_enabled && <Badge>REC</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deactivate(line.phone_number)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="ui-badge">{children}</span>
}
