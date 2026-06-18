import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'

export interface AvailableExt {
  available: string[]
  vs_customer_id: number
}

export interface UseExtensionsResult {
  available: AvailableExt | null
  extNumber: string
  setExtNumber: (v: string) => void
  adding: boolean
  error: string
  success: string
  addExtension: () => Promise<void>
}

export function useExtensions(): UseExtensionsResult {
  const [available, setAvailable] = useState<AvailableExt | null>(null)
  const [extNumber, setExtNumber] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    api.extensions
      .getAvailable(DEMO_VS_CUSTOMER_ID, 100, 199)
      .then(setAvailable)
      .catch((error) => {
        logger.error('Failed to load available extensions', { error })
      })
  }, [])

  async function addExtension() {
    if (!extNumber.trim()) return
    setAdding(true)
    setError('')
    setSuccess('')
    try {
      const ext = await api.extensions.add({
        vs_customer_id: DEMO_VS_CUSTOMER_ID,
        extension_number: extNumber.trim(),
      })
      setSuccess(`Extension ${ext.extension_number} created. SIP: ${ext.sip_username}`)
      setExtNumber('')
      const upd = await api.extensions.getAvailable(DEMO_VS_CUSTOMER_ID, 100, 199)
      setAvailable(upd)
    } catch (e) {
      setError(String(e))
    } finally {
      setAdding(false)
    }
  }

  return { available, extNumber, setExtNumber, adding, error, success, addExtension }
}
