import { Phone, PhoneCall, Radio, MessageSquare } from 'lucide-react'
import { StatCard, Card } from '../../../components/Card'
import { Button } from '../../../components/Button'
import type { UseDashboardResult } from '../../../hooks/useDashboard'

export default function DashboardView({
  customer,
  phoneLines,
  lineCount,
  apiOnline,
  loading,
  seedDemoCustomer,
}: UseDashboardResult) {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="page-title text-4xl font-extrabold">Dashboard</h1>
        <p className="page-subtitle text-base font-medium mt-1">
          Carameli status overview
        </p>
      </div>

      {/* API status banner */}
      {apiOnline === false && (
        <div
          className="rounded-[20px] px-6 py-4 flex items-center gap-3"
          style={{ background: 'rgba(220, 60, 40, 0.15)', border: '1px solid rgba(220,60,40,0.3)' }}
        >
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <p className="text-body-soft font-medium">
            API is offline — make sure <code className="text-code-accent">docker compose up</code> is running on port 8000.
          </p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        <StatCard
          label="Active Phone Lines"
          value={loading ? '…' : lineCount}
          icon={<Phone size={32} />}
          loading={loading}
        />
        <StatCard
          label="Extensions"
          value={loading ? '…' : '—'}
          icon={<PhoneCall size={32} />}
          loading={loading}
        />
        <StatCard
          label="Call Events (today)"
          value={loading ? '…' : '—'}
          icon={<Radio size={32} />}
          loading={loading}
        />
        <StatCard
          label="SMS Enabled Lines"
          value={loading ? '…' : phoneLines.filter((l) => l.sms_enabled).length}
          icon={<MessageSquare size={32} />}
          loading={loading}
        />
      </div>

      {/* Customer card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="section-title font-bold text-xl mb-4">Demo Customer</h2>
          {customer ? (
            <div className="space-y-3">
              <Row label="VS Customer ID" value={String(customer.vs_customer_id)} />
              <Row label="Internal ID" value={customer.id.slice(0, 8) + '…'} />
              <Row label="Twilio SID" value={customer.twilio_account_sid} />
              <Row label="Status" value={customer.active ? 'Active' : 'Inactive'} />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-body-soft text-sm">
                No customer seeded yet. Click below to create a demo customer (vs_customer_id = 1).
              </p>
              <Button size="sm" onClick={seedDemoCustomer}>
                Seed Demo Customer
              </Button>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="section-title font-bold text-xl mb-4">Phone Lines</h2>
          {phoneLines.length === 0 ? (
            <p className="text-body-soft text-sm">
              No phone lines provisioned yet. Go to Phone Lines to add one.
            </p>
          ) : (
            <div className="space-y-2">
              {phoneLines.slice(0, 5).map((line) => (
                <div
                  key={line.id}
                  className="flex items-center justify-between rounded-[12px] px-4 py-2"
                  style={{ background: 'rgba(255,159,28,0.06)' }}
                >
                  <span className="field-value text-sm">{line.phone_number}</span>
                  <div className="flex gap-2">
                    {line.sms_enabled && (
                      <span className="ui-badge">SMS</span>
                    )}
                    {line.recording_enabled && (
                      <span className="ui-badge">REC</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="field-label">{label}</span>
      <span className="field-value font-mono">{value}</span>
    </div>
  )
}
