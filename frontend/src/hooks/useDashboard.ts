import { useEffect, useState } from 'react'
import { api, type Customer, type PhoneLine } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'

export interface UseDashboardResult {
  customer: Customer | null
  phoneLines: PhoneLine[]
  lineCount: number
  apiOnline: boolean | null
  loading: boolean
  seedDemoCustomer: () => Promise<void>
}

export function useDashboard(): UseDashboardResult {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [phoneLines, setPhoneLines] = useState<PhoneLine[]>([])
  const [lineCount, setLineCount] = useState<number>(0)
  const [apiOnline, setApiOnline] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        await api.health()
        setApiOnline(true)

        // Only load customer data when authenticated to avoid console errors
        // when the session cookie is absent (e.g. E2E tests, first load).
        const authRes = await fetch('/auth/me', { credentials: 'include' })
        if (authRes.ok) {
          try {
            const c = await api.customers.get(DEMO_VS_CUSTOMER_ID)
            setCustomer(c)
            const lines = await api.customers.getPhoneLines(DEMO_VS_CUSTOMER_ID)
            setPhoneLines(lines)
            const cnt = await api.phoneLines.getCount(DEMO_VS_CUSTOMER_ID)
            setLineCount(cnt.count)
          } catch {
            // Customer not seeded yet — that's fine for first run
          }
        }
      } catch {
        setApiOnline(false)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function seedDemoCustomer() {
    try {
      await api.customers.create({
        vs_customer_id: DEMO_VS_CUSTOMER_ID,
        api_key: 'demo-customer-key',
      })
      const c = await api.customers.get(DEMO_VS_CUSTOMER_ID)
      setCustomer(c)
    } catch (e) {
      alert(String(e))
    }
  }

  return { customer, phoneLines, lineCount, apiOnline, loading, seedDemoCustomer }
}
