import { useState } from 'react'
import { ApiError } from '@/api/client'
import { DataTable, ErrorState, Segmented, Select, Skeleton, StatCard, TextInput, type Column } from '@/cvz/components'
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
  type RecorteIndicadores,
  type Satisfacao,
  type TabelaResumo,
} from './dados'
import {
  classeDoDelta,
  direcaoVariacao,
  formatarDuracao,
  formatarNota,
  formatarPercentual,
  formatarValorKpi,
  formatarVariacao,
  sentidoDoKpi,
  type Sentido,
} from './formato'

// Mesma ordem/rótulo de `indicators.PERIODS` — fixo o bastante para não valer
// a pena esperar a primeira resposta da API só para desenhar os três botões.
// Exportado porque `PainelChats` usa o mesmo seletor sobre o mesmo enum
// (`ChavePeriodo`) — duplicar os três botões custaria mais do que importar.
export const PERIODOS: { key: ChavePeriodo; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Esta semana' },
  { key: 'month', label: 'Este mês' },
]

type ChaveRecorte = ChavePeriodo | 'custom'

const OPCOES_RECORTE: { key: ChaveRecorte; label: string }[] = [
  ...PERIODOS,
  { key: 'custom', label: 'Personalizado' },
]

const ICONE_KPI: Record<string, typeof IconTicket> = {
  opened: IconTicket,
  resolved: IconCircleCheck,
  resolved_on_time: IconZap,
  first_response: IconClock,
  resolution: IconClock,
  csat: IconUser,
}

/** "AAAA-MM-DD" de hoje menos N dias, no fuso de quem usa. */
function diaISO(diasAtras = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - diasAtras)
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

function CardKpi({ kpi }: { kpi: Kpi }) {
  const Icon = ICONE_KPI[kpi.key]
  return (
    <div title={kpi.description}>
      <StatCard
        label={kpi.label}
        value={formatarValorKpi(kpi.value, kpi.unit)}
        Icon={Icon}
        deltaMeaning={sentidoDoKpi(kpi.direction)}
        delta={
          kpi.variation != null
            ? { value: formatarVariacao(kpi.variation), direction: direcaoVariacao(kpi.variation) }
            : undefined
        }
      />
    </div>
  )
}

/** Número + variação. O zero recua para o cinza: num período curto ele é o
 *  caso comum, e em negrito três tabelas viravam uma parede de zeros. */
function Valor({ celula, sentido }: { celula: Celula | undefined; sentido: Sentido }) {
  if (!celula) return <span className="relatorios-zero">—</span>
  const valor = celula.value ?? 0
  return (
    <>
      <span className={valor === 0 ? 'relatorios-zero' : undefined}>{valor}</span>
      {celula.variation != null && (
        <span className={classeDoDelta(celula.variation, sentido)} title="Em relação ao período anterior">
          {formatarVariacao(celula.variation)}
        </span>
      )}
    </>
  )
}

// Aberto subir não é bom nem ruim (é volume); pendente subir é ruim;
// resolvido subir é bom — o mesmo critério dos KPIs, por tabela.
const SENTIDO_DA_TABELA: Record<TabelaResumo['key'], Sentido> = {
  opened: 'neutral',
  pending: 'up-is-bad',
  resolved: 'up-is-good',
}

const TITULO_DA_TABELA: Record<TabelaResumo['key'], string> = {
  opened: 'Abertos',
  pending: 'Pendentes',
  resolved: 'Resolvidos',
}

function TabelaResumoPeriodo({ tabela }: { tabela: TabelaResumo }) {
  const sentido = SENTIDO_DA_TABELA[tabela.key] ?? 'neutral'
  return (
    <div className="relatorios-tabela__wrap">
      <table className="relatorios-tabela">
        <caption>{TITULO_DA_TABELA[tabela.key] ?? tabela.label}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Escopo</span>
            </th>
            {PERIODOS.map((p) => (
              <th key={p.key} scope="col" className="num">
                {p.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabela.rows.map((linha) => (
            <tr key={linha.key} className={linha.key === 'total' ? 'relatorios-tabela__total' : undefined}>
              <th scope="row">{linha.label}</th>
              {PERIODOS.map((p) => (
                <td key={p.key} className="num">
                  <Valor celula={linha.cells[p.key]} sentido={sentido} />
                </td>
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
    render: (r) => <Valor celula={r} sentido="up-is-good" />,
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

/** Esqueleto com a forma do painel: seis cartões, três tabelas e o gráfico. */
function EsqueletoIndicadores() {
  return (
    <div className="relatorios-esqueleto" aria-busy="true" aria-label="Carregando indicadores">
      <div className="relatorios-kpis">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="stat-card">
            <Skeleton width="60%" />
            <Skeleton width="40%" height="28px" />
          </div>
        ))}
      </div>
      <div className="relatorios-resumos">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="relatorios-esqueleto__bloco">
            <Skeleton lines={4} />
          </div>
        ))}
      </div>
      <div className="relatorios-esqueleto__bloco relatorios-esqueleto__bloco--grafico">
        <Skeleton height="160px" />
      </div>
    </div>
  )
}

/**
 * O painel gerencial: uma requisição, quinze widgets sobre a mesma leitura
 * (ver `IndicatorsView`/`build_indicators`). Backend já filtra pelo escopo de
 * quem vê o quê (`visible_tickets`) — aqui só o recorte (atalho ou intervalo
 * livre) e a equipe.
 */
export function PainelIndicadores() {
  const [chave, setChave] = useState<ChaveRecorte>('month')
  const [de, setDe] = useState(() => diaISO(29))
  const [ate, setAte] = useState(() => diaISO(0))
  const [teamId, setTeamId] = useState<number | null>(null)
  const equipes = useEquipes()
  const recorte: RecorteIndicadores = chave === 'custom' ? { period: 'custom', from: de, to: ate } : { period: chave }
  const indicadores = useIndicadores(recorte, teamId)

  const opcoesEquipe = [{ value: '', label: 'Todas as equipes' }, ...(equipes.data ?? []).map((e) => ({ value: String(e.id), label: e.name }))]
  const dados = indicadores.data

  return (
    <div className="relatorios-painel">
      <div className="relatorios-filtros">
        <Segmented label="Período" options={OPCOES_RECORTE} value={chave} onChange={setChave} />
        {chave === 'custom' && (
          <div className="relatorios-intervalo">
            <TextInput label="De" type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} />
            <TextInput label="Até" type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} />
          </div>
        )}
        <Select
          label="Equipe"
          value={teamId ? String(teamId) : ''}
          onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : null)}
          options={opcoesEquipe}
        />
      </div>
      {dados && (
        <p className="relatorios-periodo-legenda">
          {dados.period.key === 'custom' ? `De ${dados.period.label}. ` : ''}
          As variações comparam com o mesmo trecho do período anterior.
        </p>
      )}

      {indicadores.isError ? (
        <ErrorState description={indicadores.error instanceof ApiError ? indicadores.error.detail : undefined} onRetry={() => indicadores.refetch()} />
      ) : !dados ? (
        <EsqueletoIndicadores />
      ) : (
        <div className={'relatorios-painel' + (indicadores.isPlaceholderData ? ' relatorios-painel--atualizando' : '')}>
          <section className="relatorios-secao" aria-label="Principais indicadores">
            <div className="relatorios-kpis">
              {dados.kpis.map((kpi) => (
                <CardKpi key={kpi.key} kpi={kpi} />
              ))}
            </div>
          </section>

          <section className="relatorios-secao">
            <h2 className="relatorios-secao__titulo">Resumo por período</h2>
            <div className="relatorios-resumos">
              {dados.summaries.map((tabela) => (
                <TabelaResumoPeriodo key={tabela.key} tabela={tabela} />
              ))}
            </div>
          </section>

          <section className="relatorios-secao">
            <h2 className="relatorios-secao__titulo">Abertos e resolvidos por dia</h2>
            <GraficoLinhaDoTempo pontos={dados.timeline} />
          </section>

          <section className="relatorios-secao">
            <h2 className="relatorios-secao__titulo">Distribuições</h2>
            <div className="relatorios-grade-distribuicoes">
              <Distribuicao titulo="Por status" esquema="status" itens={dados.by_status} />
              <Distribuicao titulo="Por prioridade" esquema="prioridade" itens={dados.by_priority} />
              <Distribuicao titulo="Por categoria" esquema="categorias" itens={dados.by_category} />
              <Distribuicao titulo="Por empresa" esquema="categorias" itens={dados.by_company} />
              <Distribuicao titulo="Por solicitante" esquema="categorias" itens={dados.by_requester} />
              <Distribuicao titulo="Resolvidos por agente" esquema="categorias" itens={dados.resolved_by_agent} />
            </div>
          </section>

          <section className="relatorios-secao">
            <h2 className="relatorios-secao__titulo">Cumprimento de SLA</h2>
            <div className="relatorios-grade-sla">
              <Distribuicao titulo="Primeira resposta (abertos no período)" esquema="sla" itens={dados.first_response} />
              <Distribuicao titulo="Resolução (fechados no período)" esquema="sla" itens={dados.resolution} />
            </div>
          </section>

          <section className="relatorios-secao">
            <h2 className="relatorios-secao__titulo">Satisfação</h2>
            <BlocoSatisfacao satisfacao={dados.satisfaction} />
          </section>

          <section className="relatorios-secao">
            <h2 className="relatorios-secao__titulo">Por agente</h2>
            <DataTable
              rows={dados.agent_list}
              columns={COLUNAS_AGENTE}
              rowKey={(r) => r.label}
              empty="Nenhum ticket resolvido no período. Escolha um período maior acima."
            />
          </section>
        </div>
      )}
    </div>
  )
}
