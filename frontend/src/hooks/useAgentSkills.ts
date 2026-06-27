import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type AgentSkill } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import type { DataColumn, DataPageProps } from '../lib/dataPage'

const COLUMNS: DataColumn[] = [
  { key: 'skill', label: 'Skill' },
  { key: 'level', label: 'Level' },
  { key: 'agent_id', label: 'Agent ID' },
]

function toRow(s: AgentSkill): Record<string, string> {
  return {
    id: s.id,
    skill: s.skill,
    level: String(s.level),
    agent_id: s.agent_id,
  }
}

/**
 * Data hook for the Agent Skills management page (cloudli spec §37). Lists all
 * skill records across a customer's agents and provides full CRUD via DataPage.
 */
export function useAgentSkills(): DataPageProps {
  const [skills, setSkills] = useState<AgentSkill[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    logger.info('Loading agent skills', { route: '/agent-skills' })
    setError('')
    try {
      const res = await api.agentSkills.list(DEMO_VS_CUSTOMER_ID)
      setSkills(res.agent_skills)
    } catch (e) {
      logger.error('Failed to load agent skills', { error: String(e) })
      setError('Failed to load agent skills')
      setSkills([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allRows = useMemo(() => (skills ?? []).map(toRow), [skills])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allRows
    return allRows.filter((r) => Object.values(r).some((v) => v.toLowerCase().includes(q)))
  }, [allRows, search])

  const onFilterChange = useCallback((key: string, value: string) => {
    if (key === 'search') setSearch(value)
  }, [])

  const create = useCallback(
    async (values: Record<string, string>) => {
      logger.info('Creating agent skill', { skill: values.skill, agent_id: values.agent_id })
      setError('')
      try {
        await api.agentSkills.add({
          vs_customer_id: DEMO_VS_CUSTOMER_ID,
          agent_id: values.agent_id ?? '',
          skill: values.skill ?? '',
          level: values.level ? Number(values.level) : 1,
        })
        await load()
      } catch (e) {
        logger.error('Failed to create agent skill', { error: String(e) })
        setError('Failed to create agent skill')
      }
    },
    [load],
  )

  const deactivate = useCallback(
    async (row: Record<string, string>) => {
      logger.info('Deactivating agent skill', { id: row.id })
      setError('')
      try {
        await api.agentSkills.deactivate(DEMO_VS_CUSTOMER_ID, row.id)
        await load()
      } catch (e) {
        logger.error('Failed to deactivate agent skill', { error: String(e) })
        setError('Failed to deactivate agent skill')
      }
    },
    [load],
  )

  const exportCsv = useCallback(() => {
    const header = COLUMNS.map((c) => c.label).join(',')
    const body = rows
      .map((r) => COLUMNS.map((c) => `"${(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'agent-skills.csv'
    a.click()
    URL.revokeObjectURL(url)
    logger.info('Exported agent skills CSV', { count: rows.length })
  }, [rows])

  return {
    title: 'Agent Skills',
    description: 'Skill assignments for contact-centre agents',
    loading: skills === null,
    error,
    filters: [{ key: 'search', label: 'Search', kind: 'search', value: search }],
    onFilterChange,
    columns: COLUMNS,
    rows,
    actions: [
      { key: 'refresh', label: 'Refresh', onClick: () => void load(), variant: 'primary' },
      { key: 'export', label: 'Export CSV', onClick: exportCsv },
    ],
    rowActions: [
      {
        key: 'deactivate',
        label: 'Deactivate',
        variant: 'danger',
        onClick: (row) => void deactivate(row),
      },
    ],
    form: {
      newLabel: 'New',
      submitLabel: 'Create',
      fields: [
        {
          key: 'agent_id',
          label: 'Agent ID (UUID)',
          kind: 'text',
          placeholder: 'paste agent UUID',
          required: true,
        },
        { key: 'skill', label: 'Skill', kind: 'text', placeholder: 'spanish', required: true },
        { key: 'level', label: 'Level (1–100)', kind: 'text', placeholder: '1', default: '1' },
      ],
      onSubmit: create,
    },
    emptyText: 'No agent skills configured',
  }
}
