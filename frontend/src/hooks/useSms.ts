import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type SmsMessage } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import { smsSenders } from '../lib/smsConversation'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'created_at', label: 'Date' },
  { key: 'direction', label: 'Direction' },
  { key: 'from_number', label: 'From' },
  { key: 'to_number', label: 'To' },
  { key: 'body', label: 'Message' },
  { key: 'delivery_status', label: 'Status' },
]

function fmtDateTime(iso: string | null): string {
  if (!iso) return ''
  return iso.replace('T', ' ').slice(0, 16)
}

function toRow(m: SmsMessage): Record<string, string> {
  return {
    created_at: fmtDateTime(m.created_at),
    direction: m.direction ?? '',
    from_number: m.from_number ?? '',
    to_number: m.to_number ?? '',
    body: m.body ?? '',
    delivery_status: m.delivery_status ?? '',
  }
}

/**
 * Data hook for the SMS page. Owns filter state + fetching and returns a
 * DataPageProps descriptor, so the page is a thin orchestrator and every skin
 * renders the same behaviour via its DataPage view. Date filters are applied
 * server-side (re-fetch); the search box filters the loaded rows client-side.
 */
export function useSms(): DataPageProps {
  const [messages, setMessages] = useState<SmsMessage[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [senders, setSenders] = useState<string[]>([])

  const load = useCallback(async () => {
    logger.info('Loading SMS messages', { route: '/sms', start, end })
    setError('')
    try {
      const res = await api.sms.list(DEMO_VS_CUSTOMER_ID, {
        start: start || undefined,
        end: end || undefined,
        limit: 200,
      })
      setMessages(res.messages)
    } catch (e) {
      logger.error('Failed to load SMS messages', { error: String(e) })
      setError('Failed to load SMS messages')
      setMessages([])
    }
  }, [start, end])

  useEffect(() => {
    void load()
  }, [load])

  // SMS-capable DIDs for this customer. Only used to pre-fill the composer's
  // sender, so a failure here degrades to an empty field rather than an error.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const lines = await api.customers.getPhoneLines(DEMO_VS_CUSTOMER_ID)
        if (cancelled) return
        setSenders(smsSenders(lines))
      } catch (e) {
        logger.warn('Failed to load SMS-capable phone lines', { error: String(e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const send = useCallback(
    async (values: Record<string, string>) => {
      const fromNumber = (values.from_number ?? '').trim()
      const toNumber = (values.to_number ?? '').trim()
      const body = values.body ?? ''
      setError('')
      if (!fromNumber || !toNumber || !body.trim()) {
        setError('From, To and a message body are all required')
        return
      }
      // The backend rejects non-US/CA destinations with a 400; say so up front
      // rather than surfacing a generic provider failure.
      if (!toNumber.startsWith('+1')) {
        setError('Only +1 (US/Canada) destinations are supported')
        return
      }
      logger.info('Sending SMS', { from: fromNumber, to: toNumber, length: body.length })
      try {
        await api.sms.send(DEMO_VS_CUSTOMER_ID, {
          from_number: fromNumber,
          to_number: toNumber,
          body,
        })
        await load()
      } catch (e) {
        logger.error('Failed to send SMS', { error: String(e) })
        setError('Failed to send SMS')
      }
    },
    [load],
  )

  const allRows = useMemo(() => (messages ?? []).map(toRow), [messages])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allRows
    return allRows.filter((r) => Object.values(r).some((v) => v.toLowerCase().includes(q)))
  }, [allRows, search])

  const onFilterChange = useCallback((key: string, value: string) => {
    if (key === 'search') setSearch(value)
    else if (key === 'start') setStart(value)
    else if (key === 'end') setEnd(value)
  }, [])

  const exportCsv = useCallback(() => {
    const header = COLUMNS.map((c) => c.label).join(',')
    const body = rows
      .map((r) => COLUMNS.map((c) => `"${(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sms-messages.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported SMS messages CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'SMS',
    description: 'Send and review SMS messages via the active carrier',
    loading: messages === null,
    error,
    filters: [
      { key: 'search', label: 'Search', kind: 'search', value: search },
      { key: 'start', label: 'From date', kind: 'date', value: start },
      { key: 'end', label: 'To date', kind: 'date', value: end },
    ],
    onFilterChange,
    columns: COLUMNS,
    rows,
    actions: [
      { key: 'refresh', label: 'Refresh', onClick: () => void load(), variant: 'primary' },
      { key: 'export', label: 'Export CSV', onClick: exportCsv },
    ],
    form: {
      newLabel: 'New message',
      submitLabel: 'Send',
      fields: [
        {
          key: 'from_number',
          label: 'From (an SMS-enabled Carameli number)',
          kind: 'text',
          placeholder: '+15551234567',
          required: true,
          default: senders[0] ?? '',
        },
        {
          key: 'to_number',
          label: 'To',
          kind: 'text',
          placeholder: '+15557654321',
          required: true,
        },
        { key: 'body', label: 'Message', kind: 'textarea', required: true },
      ],
      onSubmit: send,
    },
    emptyText: 'No SMS messages for the selected range',
  }
}
