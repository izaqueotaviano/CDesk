import { useState } from 'react'
import { ApiError } from '@/api/client'
import { ErrorState, Select, StatCard, TextInput } from '@/cvz/components'
import { useAgentes, useEmpresasOpcoes } from '@/cvz/tickets/dados'
import { formatarDuracao } from './formato'
import { urlExportarCsv, useRelatorioTickets, type FiltrosRelatorio } from './dados'

/**
 * O mesmo dado do painel acima, num recorte livre — período e agente/empresa,
 * exportado em CSV para abrir na planilha. Não repete a lista de tickets
 * ticket a ticket: essa já existe em /chamados com os próprios filtros; aqui
 * é só o resumo do recorte + o link de exportação (`TicketReportExportView`,
 * download síncrono — sem fetch/blob).
 */
export function PainelDetalhado() {
  const [filtros, setFiltros] = useState<FiltrosRelatorio>({})
  const agentes = useAgentes()
  const empresas = useEmpresasOpcoes()
  const relatorio = useRelatorioTickets(filtros)

  const opcoesAgente = [
    { value: '', label: 'Todos os agentes' },
    ...(agentes.data ?? []).map((a) => ({ value: String(a.id), label: a.full_name })),
  ]
  const opcoesEmpresa = [
    { value: '', label: 'Todas as empresas' },
    ...(empresas.data ?? []).map((e) => ({ value: String(e.id), label: e.name })),
  ]

  function setCampo<K extends keyof FiltrosRelatorio>(campo: K, valor: string) {
    setFiltros((f) => ({ ...f, [campo]: valor || undefined }))
  }

  return (
    <div className="relatorios-detalhado">
      <p className="relatorios-detalhado__intro">
        Escolha o período e baixe em CSV para abrir na sua planilha (Excel, Google Sheets). Para olhar chamado por
        chamado, use a lista de tickets — o filtro é o mesmo.
      </p>

      <div className="relatorios-detalhado__filtros">
        <TextInput label="De" type="date" value={filtros.from ?? ''} onChange={(e) => setCampo('from', e.target.value)} />
        <TextInput label="Até" type="date" value={filtros.to ?? ''} onChange={(e) => setCampo('to', e.target.value)} />
        <Select label="Agente" value={filtros.agent ?? ''} onChange={(e) => setCampo('agent', e.target.value)} options={opcoesAgente} />
        <Select label="Empresa" value={filtros.company ?? ''} onChange={(e) => setCampo('company', e.target.value)} options={opcoesEmpresa} />
      </div>

      {relatorio.isError ? (
        <ErrorState description={relatorio.error instanceof ApiError ? relatorio.error.detail : undefined} onRetry={() => relatorio.refetch()} />
      ) : relatorio.isLoading || !relatorio.data ? (
        <p>Carregando…</p>
      ) : (
        <>
          <div className="relatorios-detalhado__resumo">
            <StatCard label="Tickets no recorte" value={String(relatorio.data.summary.total)} />
            <StatCard label="Fechados" value={String(relatorio.data.summary.closed)} />
            <StatCard
              label="Reaberturas"
              value={`${relatorio.data.summary.reopened_tickets} ticket(s) · ${relatorio.data.summary.reopen_events} evento(s)`}
            />
            <StatCard label="1ª resposta média" value={formatarDuracao(relatorio.data.summary.avg_first_response_seconds)} />
            <StatCard label="Resolução média" value={formatarDuracao(relatorio.data.summary.avg_resolution_seconds)} />
            <StatCard label="Ciclo médio" value={formatarDuracao(relatorio.data.summary.avg_cycle_seconds)} />
          </div>
          <p className="relatorios-detalhado__espera">
            Tempo médio esperando o agente: {formatarDuracao(relatorio.data.summary.avg_waiting_agent_seconds)} · esperando o cliente:{' '}
            {formatarDuracao(relatorio.data.summary.avg_waiting_customer_seconds)}
          </p>
          <a className="btn btn--secondary btn--sm relatorios-detalhado__csv" href={urlExportarCsv(filtros)}>
            <span className="btn__label">Baixar CSV ({relatorio.data.rows.length} linha(s))</span>
          </a>
        </>
      )}
    </div>
  )
}
