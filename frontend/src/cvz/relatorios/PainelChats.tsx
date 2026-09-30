import { useState } from 'react'
import { ApiError } from '@/api/client'
import { DataTable, ErrorState, Segmented, Select, Skeleton, type Column } from '@/cvz/components'
import { GraficoBarrasPeriodo } from './GraficoBarrasPeriodo'
import { PERIODOS } from './PainelIndicadores'
import {
  useEstatisticasDeChat,
  type ChavePeriodo,
  type Granularidade,
  type LinhaAgenteChat,
  type LinhaEstatisticaAgente,
} from './dados'
import { classeDoDelta, formatarVariacao } from './formato'

// Mesmas quatro granularidades que `chat_stats._TRUNC` aceita — inválida no
// backend já cai para "day" sozinha, então os botões nunca mandam lixo.
const GRANULARIDADES: { key: Granularidade; label: string }[] = [
  { key: 'hour', label: 'Hora' },
  { key: 'day', label: 'Dia' },
  { key: 'month', label: 'Mês' },
  { key: 'year', label: 'Ano' },
]

// Volume de chats é contexto, não desempenho: a variação aparece neutra,
// como a de "tickets abertos" nos indicadores.
function celulaChats(linha: LinhaEstatisticaAgente) {
  return (
    <>
      <span className={linha.value === 0 ? 'relatorios-zero' : undefined}>{linha.value}</span>
      {linha.variation != null && (
        <span className={classeDoDelta(linha.variation, 'neutral')} title="Em relação ao período anterior">
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
        <Segmented label="Período" options={PERIODOS} value={period} onChange={setPeriod} />
        <Segmented label="Agrupar por" options={GRANULARIDADES} value={granularity} onChange={setGranularity} />
        <Select
          label="Agente"
          value={agentId != null ? String(agentId) : ''}
          onChange={(e) => setAgentId(e.target.value ? Number(e.target.value) : null)}
          options={opcoesAgente}
        />
      </div>

      {estatisticas.isError ? (
        <ErrorState description={estatisticas.error instanceof ApiError ? estatisticas.error.detail : undefined} onRetry={() => estatisticas.refetch()} />
      ) : !estatisticas.data ? (
        <div className="relatorios-esqueleto" aria-busy="true" aria-label="Carregando chats">
          <div className="relatorios-esqueleto__bloco">
            <Skeleton lines={4} />
          </div>
          <div className="relatorios-esqueleto__bloco">
            <Skeleton height="160px" />
          </div>
        </div>
      ) : (
        <>
          <section className="relatorios-secao">
            <h2 className="relatorios-secao__titulo">Por agente</h2>
            <DataTable
              rows={estatisticas.data.by_agent}
              columns={COLUNAS_AGENTE_CHAT}
              rowKey={(r) => (r.is_total ? 'total' : String(r.agent_id))}
              empty="Nenhum chat atendido no período. Escolha um período maior acima."
            />
          </section>

          <section className="relatorios-secao">
            <h2 className="relatorios-secao__titulo">Chats atendidos ao longo do tempo</h2>
            <GraficoBarrasPeriodo pontos={estatisticas.data.timeline} granularidade={estatisticas.data.granularity} />
          </section>
        </>
      )}
    </div>
  )
}
