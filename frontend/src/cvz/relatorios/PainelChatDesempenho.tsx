import { useState } from 'react'
import { ApiError } from '@/api/client'
import { DataTable, ErrorState, Segmented, type Column } from '@/cvz/components'
import { useRelatorioChat, type EixoRelatorioChat, type LinhaRelatorioChat } from './dados'
import { formatarMinutos, formatarNota } from './formato'

const EIXOS: { key: EixoRelatorioChat; label: string }[] = [
  { key: 'company', label: 'Empresa' },
  { key: 'client', label: 'Cliente' },
  { key: 'agent', label: 'Agente' },
  { key: 'score', label: 'Nota' },
]

const TITULO_POR_EIXO: Record<EixoRelatorioChat, string> = {
  company: 'Por empresa',
  client: 'Por cliente',
  agent: 'Por agente',
  score: 'Por nota',
}

function rotuloTexto(rotulo: string | number | null): string {
  return rotulo == null || rotulo === '' ? '—' : String(rotulo)
}

// Empresa/cliente/agente compartilham a mesma forma de linha (contagens +
// tempos + notas); só o eixo `agent` acrescenta a autoavaliação, e só
// `score` é outra forma inteiramente (ver `colunasPara` embaixo).
const COLUNAS_PADRAO: Column<LinhaRelatorioChat>[] = [
  {
    key: 'rotulo', header: 'Rótulo', mobile: 'title',
    sortBy: (r) => rotuloTexto(r.rotulo), render: (r) => rotuloTexto(r.rotulo),
  },
  {
    key: 'total', header: 'Total', numeric: true,
    sortBy: (r) => r.total ?? 0, render: (r) => r.total ?? 0,
  },
  {
    key: 'fechados', header: 'Fechados', numeric: true,
    sortBy: (r) => r.fechados ?? 0, render: (r) => r.fechados ?? 0,
  },
  {
    key: 'convertidos', header: 'Convertidos em ticket', numeric: true,
    sortBy: (r) => r.convertidos ?? 0, render: (r) => r.convertidos ?? 0,
  },
  {
    key: 'nao_atendidos', header: 'Não atendidos', numeric: true,
    sortBy: (r) => r.nao_atendidos ?? 0, render: (r) => r.nao_atendidos ?? 0,
  },
  {
    key: 'espera_media_minutos', header: 'Espera média', numeric: true,
    sortBy: (r) => r.espera_media_minutos ?? -1, render: (r) => formatarMinutos(r.espera_media_minutos),
  },
  {
    key: 'atendimento_medio_minutos', header: 'Atendimento médio', numeric: true,
    sortBy: (r) => r.atendimento_medio_minutos ?? -1, render: (r) => formatarMinutos(r.atendimento_medio_minutos),
  },
  {
    key: 'nota_atendimento', header: 'Nota de atendimento', numeric: true,
    sortBy: (r) => r.nota_atendimento ?? -1, render: (r) => formatarNota(r.nota_atendimento ?? null),
  },
  {
    key: 'nota_resolucao', header: 'Nota de resolução', numeric: true,
    sortBy: (r) => r.nota_resolucao ?? -1, render: (r) => formatarNota(r.nota_resolucao ?? null),
  },
]

const COLUNAS_AGENTE: Column<LinhaRelatorioChat>[] = [
  ...COLUNAS_PADRAO,
  {
    key: 'nota_do_agente', header: 'Autoavaliação', numeric: true,
    sortBy: (r) => r.nota_do_agente ?? -1, render: (r) => formatarNota(r.nota_do_agente ?? null),
  },
]

// `score` não tem desfecho (fechados/convertidos) nem tempo — é contagem de
// conversas por nota, então a tabela é outra, não um subconjunto da padrão.
const COLUNAS_NOTA: Column<LinhaRelatorioChat>[] = [
  {
    key: 'rotulo', header: 'Nota', mobile: 'title',
    sortBy: (r) => Number(r.rotulo ?? -1), render: (r) => rotuloTexto(r.rotulo),
  },
  {
    key: 'quantidade', header: 'Conversas', numeric: true,
    sortBy: (r) => r.quantidade ?? 0, render: (r) => r.quantidade ?? 0,
  },
  {
    key: 'nota_resolucao', header: 'Nota de resolução média', numeric: true,
    sortBy: (r) => r.nota_resolucao ?? -1, render: (r) => formatarNota(r.nota_resolucao ?? null),
  },
]

function colunasPara(eixo: EixoRelatorioChat): Column<LinhaRelatorioChat>[] {
  if (eixo === 'score') return COLUNAS_NOTA
  if (eixo === 'agent') return COLUNAS_AGENTE
  return COLUNAS_PADRAO
}

/**
 * Tempo de espera, tempo de atendimento e nota do chat — `ChatReportView`
 * (`GET /api/v1/chat/reports/?by=`). Endpoint existia sem consumidor: o
 * painel de chat só mostrava VOLUME (`PainelChats`, `ChatStatsView`), nunca
 * qualidade — quanto tempo o cliente esperou, quanto tempo o agente levou,
 * que nota tirou. Não repete `PainelChats`: é outro endpoint, outro dado.
 */
export function PainelChatDesempenho() {
  const [eixo, setEixo] = useState<EixoRelatorioChat>('company')
  const relatorio = useRelatorioChat(eixo)

  return (
    <div className="relatorios-painel">
      <div className="relatorios-filtros">
        <Segmented label="Ver por" options={EIXOS} value={eixo} onChange={setEixo} />
      </div>

      {relatorio.isError ? (
        <ErrorState
          description={relatorio.error instanceof ApiError ? relatorio.error.detail : undefined}
          onRetry={() => relatorio.refetch()}
        />
      ) : (
        <>
          <section className="relatorios-secao">
            <h2 className="relatorios-secao__titulo">{TITULO_POR_EIXO[eixo]}</h2>
            <DataTable
              rows={relatorio.data ?? []}
              columns={colunasPara(eixo)}
              rowKey={(r) => rotuloTexto(r.rotulo)}
              loading={relatorio.isLoading}
              empty="Nenhuma conversa encerrada ainda. Quando houver, as médias aparecem aqui."
            />
          </section>
        </>
      )}
    </div>
  )
}
