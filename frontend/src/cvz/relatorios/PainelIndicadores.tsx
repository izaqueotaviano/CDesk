import { useState } from 'react'
import { ApiError } from '@/api/client'
import { DataTable, ErrorState, Select, StatCard, type Column } from '@/cvz/components'
import { IconCircleCheck, IconClock, IconTicket, IconUser, IconZap } from '@/cvz/components/icons'
import { useEquipes } from '@/cvz/tickets/dados'
import { Distribuicao } from './Distribuicao'
import { GraficoLinhaDoTempo } from './GraficoLinhaDoTempo'
import {
  useIndicadores,
  type Celula,
  type ChavePeriodo,
  type Kpi,
  type LinhaAgente,
  type Satisfacao,
  type TabelaResumo,
} from './dados'
import { direcaoVariacao, formatarDuracao, formatarNota, formatarPercentual, formatarValorKpi, formatarVariacao } from './formato'

// Mesma ordem/rótulo de `indicators.PERIODS` — fixo o bastante para não valer
// a pena esperar a primeira resposta da API só para desenhar os três botões.
const PERIODOS: { key: ChavePeriodo; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Esta semana' },
  { key: 'month', label: 'Este mês' },
]

const ICONE_KPI: Record<string, typeof IconTicket> = {
  opened: IconTicket,
  resolved: IconCircleCheck,
  resolved_on_time: IconZap,
  first_response: IconClock,
  resolution: IconClock,
  csat: IconUser,
}

function CardKpi({ kpi }: { kpi: Kpi }) {
  const Icon = ICONE_KPI[kpi.key]
  const temVariacao = kpi.variation != null
  return (
    <div title={kpi.description}>
      <StatCard
        label={kpi.label}
        value={formatarValorKpi(kpi.value, kpi.unit)}
        Icon={Icon}
        deltaMeaning={kpi.direction === 'down' ? 'up-is-bad' : 'up-is-good'}
        delta={
          temVariacao
            ? {
                value: formatarVariacao(kpi.variation),
                // direção neutra (KPI sem "lado bom") não pinta a variação —
                // só mostra o número, como o próprio backend documenta.
                direction: kpi.direction == null ? 'flat' : direcaoVariacao(kpi.variation),
              }
            : undefined
        }
      />
    </div>
  )
}

function celulaOuTraco(c: Celula | undefined) {
  if (!c) return '—'
  return (
    <>
      <b>{c.value ?? 0}</b>
      {c.variation != null && (
        <span className={`relatorios-delta relatorios-delta--${direcaoVariacao(c.variation)}`}>
          {' '}
          {formatarVariacao(c.variation)}
        </span>
      )}
    </>
  )
}

function TabelaResumoPeriodo({ tabela }: { tabela: TabelaResumo }) {
  return (
    <div className="relatorios-tabela__wrap">
      <table className="relatorios-tabela">
        <caption>{tabela.label}</caption>
        <thead>
          <tr>
            <th>Escopo</th>
            {PERIODOS.map((p) => (
              <th key={p.key}>{p.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabela.rows.map((linha) => (
            <tr key={linha.key}>
              <td>{linha.label}</td>
              {PERIODOS.map((p) => (
                <td key={p.key}>{celulaOuTraco(linha.cells[p.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BlocoSatisfacao({ satisfacao }: { satisfacao: Satisfacao }) {
  const max = Math.max(1, ...satisfacao.distribution.map((d) => d.count))
  return (
    <div className="relatorios-satisfacao">
      <div className="relatorios-satisfacao__resumo">
        <div className="relatorios-satisfacao__nota">{formatarNota(satisfacao.average)}</div>
        <p className="relatorios-satisfacao__legenda">
          {satisfacao.answers} de {satisfacao.resolved} ticket(s) resolvido(s) responderam a pesquisa
        </p>
      </div>
      {satisfacao.answers > 0 && (
        <div className="relatorios-satisfacao__barras">
          {satisfacao.distribution.map((d) => (
            <div key={d.score} className="relatorios-satisfacao__coluna" title={`Nota ${d.score}: ${d.count} resposta(s)`}>
              <div className="relatorios-satisfacao__trilho">
                <div className="relatorios-satisfacao__barra" style={{ height: `${(d.count / max) * 100}%` }} />
              </div>
              <span className="relatorios-satisfacao__rotulo">{d.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const COLUNAS_AGENTE: Column<LinhaAgente>[] = [
  {
    key: 'label',
    header: 'Agente',
    mobile: 'title',
    sortBy: (r) => r.label,
    render: (r) => (r.is_total ? <strong>{r.label}</strong> : r.label),
  },
  {
    key: 'resolvidos',
    header: 'Resolvidos',
    numeric: true,
    sortBy: (r) => r.value ?? 0,
    render: (r) => celulaOuTraco(r),
  },
  {
    key: 'teams',
    header: 'Equipes',
    render: (r) => (r.teams.length ? r.teams.map((t) => t.name).join(', ') : '—'),
  },
  {
    key: 'on_time_rate',
    header: 'No prazo',
    numeric: true,
    sortBy: (r) => r.on_time_rate ?? -1,
    render: (r) => formatarPercentual(r.on_time_rate),
  },
  {
    key: 'first_response_seconds',
    header: '1ª resposta',
    numeric: true,
    sortBy: (r) => r.first_response_seconds ?? -1,
    render: (r) => formatarDuracao(r.first_response_seconds),
  },
  {
    key: 'score',
    header: 'Nota',
    numeric: true,
    sortBy: (r) => r.score ?? -1,
    render: (r) => formatarNota(r.score),
  },
]

/**
 * O painel gerencial: uma requisição, quinze widgets sobre a mesma leitura
 * (ver `IndicatorsView`/`build_indicators`). Backend já filtra pelo escopo de
 * quem vê o quê (`visible_tickets`) — aqui só period/team, que são os dois
 * parâmetros que a view aceita.
 */
export function PainelIndicadores() {
  const [period, setPeriod] = useState<ChavePeriodo>('month')
  const [teamId, setTeamId] = useState<number | null>(null)
  const equipes = useEquipes()
  const indicadores = useIndicadores(period, teamId)

  const opcoesEquipe = [{ value: '', label: 'Todas as equipes' }, ...(equipes.data ?? []).map((e) => ({ value: String(e.id), label: e.name }))]

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
        <Select
          label="Equipe"
          value={teamId ? String(teamId) : ''}
          onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : null)}
          options={opcoesEquipe}
        />
      </div>

      {indicadores.isError ? (
        <ErrorState description={indicadores.error instanceof ApiError ? indicadores.error.detail : undefined} onRetry={() => indicadores.refetch()} />
      ) : indicadores.isLoading || !indicadores.data ? (
        <p>Carregando…</p>
      ) : (
        <>
          <div className="relatorios-kpis">
            {indicadores.data.kpis.map((kpi) => (
              <CardKpi key={kpi.key} kpi={kpi} />
            ))}
          </div>

          <div className="relatorios-resumos">
            {indicadores.data.summaries.map((tabela) => (
              <TabelaResumoPeriodo key={tabela.key} tabela={tabela} />
            ))}
          </div>

          <h2 className="relatorios-secao__titulo">Linha do tempo</h2>
          <GraficoLinhaDoTempo pontos={indicadores.data.timeline} />

          <h2 className="relatorios-secao__titulo">Distribuições</h2>
          <div className="relatorios-grade-distribuicoes">
            <Distribuicao titulo="Por status" itens={indicadores.data.by_status} />
            <Distribuicao titulo="Por prioridade" itens={indicadores.data.by_priority} />
            <Distribuicao titulo="Por categoria" itens={indicadores.data.by_category} />
            <Distribuicao titulo="Por empresa" itens={indicadores.data.by_company} />
            <Distribuicao titulo="Por solicitante" itens={indicadores.data.by_requester} />
            <Distribuicao titulo="Resolvidos por agente" itens={indicadores.data.resolved_by_agent} />
          </div>

          <h2 className="relatorios-secao__titulo">Cumprimento de SLA</h2>
          <div className="relatorios-grade-sla">
            <Distribuicao titulo="Primeira resposta (abertos no período)" itens={indicadores.data.first_response} />
            <Distribuicao titulo="Resolução (fechados no período)" itens={indicadores.data.resolution} />
          </div>

          <h2 className="relatorios-secao__titulo">Satisfação</h2>
          <BlocoSatisfacao satisfacao={indicadores.data.satisfaction} />

          <h2 className="relatorios-secao__titulo">Por agente</h2>
          <DataTable
            rows={indicadores.data.agent_list}
            columns={COLUNAS_AGENTE}
            rowKey={(r) => r.label}
            empty="Nenhum ticket resolvido no período."
          />
        </>
      )}
    </div>
  )
}
