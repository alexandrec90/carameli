import { useEffect, useState } from 'react'
import { api, type PhoneLine } from '../api/client'

const CUSTOMER_ID = 1

export interface UsePhoneLinesResult {
  lines: PhoneLine[]
  loading: boolean
  areaCode: string
  setAreaCode: (v: string) => void
  adding: boolean
  error: string
  addLine: () => Promise<void>
  deactivate: (phone_number: string) => Promise<void>
}

export function usePhoneLines(): UsePhoneLinesResult {
  const [lines, setLines] = useState<PhoneLine[]>([])
  const [loading, setLoading] = useState(true)
  const [areaCode, setAreaCode] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const data = await api.customers.getPhoneLines(CUSTOMER_ID)
      setLines(data)
    } catch {
      setLines([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function addLine() {
    if (!areaCode.trim()) return
    setAdding(true)
    setError('')
    try {
      await api.phoneLines.add({ vs_customer_id: CUSTOMER_ID, area_code: areaCode.trim() })
      setAreaCode('')
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setAdding(false)
    }
  }

  async function deactivate(phone_number: string) {
    if (!confirm(`Deactivate ${phone_number}? This releases it from Twilio.`)) return
    try {
      await api.phoneLines.deactivate({ vs_customer_id: CUSTOMER_ID, phone_number })
      await load()
    } catch (e) {
      alert(String(e))
    }
  }

  return { lines, loading, areaCode, setAreaCode, adding, error, addLine, deactivate }
}
