import { useState } from 'react'
import { ErrorState, Select, TextInput } from '@/cvz/components'
import { ApiError } from '@/api/client'
import { useLogsAuditoria } from './dados'

const ACOES = [
  { value: '', label: 'Todas as ações' },
  { value: 'create', label: 'Criação' },
  { value: 'update', label: 'Atualização' },
  { value: 'delete', label: 'Exclusão' },
  { value: 'status_change', label: 'Mudança de status' },
  { value: 'assign', label: 'Atribuição' },
  { value: 'login', label: 'Login' },
  { value: 'config_change', label: 'Mudança de configuração' },
  { value: 'export', label: 'Exportação' },
  { value: 'anonymize', label: 'Anonimização' },
  { value: 'scan_blocked', label: 'Anexo bloqueado' },
]

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Trilha de auditoria — append-only (nada aqui foi editado nem apagado por
 *  fora do expurgo automático de retenção). Filtros batem exatamente com o
 *  que `AuditLogViewSet.get_queryset` aceita: ação, autor (id) e data inicial. */
export function PainelLogs() {
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [from, setFrom] = useState('')
  const logs = useLogsAuditoria({ action: action || undefined, actor: actor || undefined, from: from || undefined })

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Select label="Ação" value={action} onChange={(e) => setAction(e.target.value)} options={ACOES} />
        <TextInput label="ID do autor" placeholder="Ex.: 42" value={actor} onChange={(e) => setActor(e.target.value.replace(/\D/g, ''))} />
        <TextInput label="A partir de" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>

      {logs.isError ? (
        <ErrorState description={logs.error instanceof ApiError ? logs.error.detail : undefined} onRetry={() => logs.refetch()} />
      ) : (
        <div className="auditoria-tabela__wrap">
          <table className="auditoria-tabela">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Ação</th>
                <th>Objeto</th>
                <th>Resumo</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.isLoading ? (
                <tr>
                  <td colSpan={6}>Carregando…</td>
                </tr>
              ) : logs.data && logs.data.results.length > 0 ? (
                logs.data.results.map((l) => (
                  <tr key={l.id}>
                    <td>{formatarData(l.created_at)}</td>
                    <td>{l.actor_name}</td>
                    <td>{ACOES.find((a) => a.value === l.action)?.label ?? l.action}</td>
                    <td>
                      {l.target_type} #{l.object_id}
                    </td>
                    <td>{l.summary}</td>
                    <td>{l.ip_address || '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>Nenhum registro para esse filtro.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
