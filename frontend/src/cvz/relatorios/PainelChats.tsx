import { useState } from 'react'
import { ApiError } from '@/api/client'
import { DataTable, ErrorState, Select, type Column } from '@/cvz/components'
import { GraficoBarrasPeriodo } from './GraficoBarrasPeriodo'
import { PERIODOS } from './PainelIndicadores'
import {
  useEstatisticasDeChat,
  type ChavePeriodo,
  type Granularidade,
  type LinhaAgenteChat,
  type LinhaEstatisticaAgente,
} from './dados'
import { direcaoVariacao, formatarVariacao } from './formato'

// Mesmas quatro granularidades que `chat_stats._TRUNC` aceita — inválida no
// backend já cai para "day" sozinha, então os botões nunca mandam lixo.
const GRANULARIDADES: { key: Granularidade; label: string }[] = [
  { key: 'hour', label: 'Hora' },
  { key: 'day', label: 'Dia' },
  { key: 'month', label: 'Mês' },
  { key: 'year', label: 'Ano' },
]

function celulaChats(linha: LinhaEstatisticaAgente) {
  return (
    <>
      <b>{linha.value}</b>
      {linha.variation != null && (
        <span className={`relatorios-delta relatorios-delta--${direcaoVariacao(linha.variation)}`}>
          {' '}
          {formatarVariacao(linha.variation)}
        </span>
      )}
    </>
  )
}

const COLUNAS_AGENTE_CHAT: Column<LinhaEstatisticaAgente>[] = [
  {
    key: 'agente',
    header: 'Agente',
    mobile: 'title',
    sortBy: (r) => (r.is_total ? r.label : r.agent_name),
    render: (r) => (r.is_total ? <strong>{r.label}</strong> : r.agent_name),
  },
  {
    key: 'chats',
    header: 'Chats atendidos',
    numeric: true,
    sortBy: (r) => r.value,
    render: celulaChats,
  },
]

/**
 * Quantos chats cada agente atendeu, no período e ao longo do tempo — ver
 * `ChatStatsView`/`build_chat_stats`. "Atendido" é medido por `accepted_at`;
 * um chat reaberto e pego de novo só entra pela ÚLTIMA aceitação (a
 * anterior não deixa rastro nenhum — limitação documentada no backend, não
 * bug desta tela).
 */
export function PainelChats() {
  const [period, setPeriod] = useState<ChavePeriodo>('month')
  const [granularity, setGranularity] = useState<Granularidade>('day')
  const [agentId, setAgentId] = useState<number | null>(null)
  const estatisticas = useEstatisticasDeChat({ period, granularity, agentId })

  // Vem do próprio `by_agent` já carregado — não vale abrir uma segunda
  // consulta só para listar quem tem chat atendido no período.
  const opcoesAgente = [
    { value: '', label: 'Todos os agentes' },
    ...(estatisticas.data?.by_agent ?? [])
      .filter((l): l is LinhaAgenteChat => !l.is_total)
      .map((l) => ({ value: String(l.agent_id), label: l.agent_name })),
  ]

  return (
    <div className="relatorios-painel">
      <div className="relatorios-filtros">
        <div className="relatorios-periodo" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={'relatorios-periodo__botao' + (p.key === period ? ' relatorios-periodo__botao--ativo' : '')}
              aria-pressed={p.key === period}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="relatorios-periodo" role="group" aria-label="Granularidade">
          {GRANULARIDADES.map((g) => (
            <button
              key={g.key}
              type="button"
              className={'relatorios-periodo__botao' + (g.key === granularity ? ' relatorios-periodo__botao--ativo' : '')}
              aria-pressed={g.key === granularity}
              onClick={() => setGranularity(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <Select
          label="Agente"
          value={agentId != null ? String(agentId) : ''}
          onChange={(e) => setAgentId(e.target.value ? Number(e.target.value) : null)}
          options={opcoesAgente}
        />
      </div>

      {estatisticas.isError ? (
        <ErrorState description={estatisticas.error instanceof ApiError ? estatisticas.error.detail : undefined} onRetry={() => estatisticas.refetch()} />
      ) : estatisticas.isLoading || !estatisticas.data ? (
        <p>Carregando…</p>
      ) : (
        <>
          <h2 className="relatorios-secao__titulo">Por agente</h2>
          <DataTable
            rows={estatisticas.data.by_agent}
            columns={COLUNAS_AGENTE_CHAT}
            rowKey={(r) => (r.is_total ? 'total' : String(r.agent_id))}
            empty="Nenhum chat atendido no período."
          />

          <h2 className="relatorios-secao__titulo">Linha do tempo</h2>
          <GraficoBarrasPeriodo pontos={estatisticas.data.timeline} />
        </>
      )}
    </div>
  )
}
