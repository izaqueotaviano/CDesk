import { Button, Tag, useToast, type TagTone } from '@/cvz/components'
import { ApiError } from '@/api/client'
import {
  urlBaixarExportacao,
  useCriarExportacao,
  useExportacoesRelatorio,
  type FiltrosRelatorio,
  type FormatoExportacao,
  type StatusExportacao,
} from './dados'

const ROTULO_STATUS: Record<StatusExportacao, { rotulo: string; tom: TagTone }> = {
  pending: { rotulo: 'Na fila', tom: 'neutral' },
  running: { rotulo: 'Gerando…', tom: 'blue' },
  done: { rotulo: 'Pronto', tom: 'success' },
  failed: { rotulo: 'Falhou', tom: 'danger' },
}

function formatarQuando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function mensagemDeErro(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.detail ?? padrao) : padrao
}

const ROTULO_FORMATO: Record<FormatoExportacao, string> = { xlsx: 'Gerar Excel (XLSX)', pdf: 'Gerar PDF' }

/**
 * Exportação assíncrona — complementa o CSV síncrono (que já cobre "tirar os
 * dados daqui" na hora). XLSX/PDF passam pela fila (Celery,
 * `build_report_export`) porque o arquivo é mais pesado de montar; por isso
 * a lista abaixo se atualiza sozinha enquanto algo está "Na fila"/"Gerando".
 */
export function PainelExportacoes({ filtros }: { filtros: FiltrosRelatorio }) {
  const exportacoes = useExportacoesRelatorio()
  const criar = useCriarExportacao()
  const { push } = useToast()

  function gerar(format: FormatoExportacao) {
    criar.mutate(
      { format, params: filtros },
      {
        onSuccess: () => push({ tone: 'success', title: 'Exportação na fila', description: 'Avisamos aqui embaixo quando estiver pronta.' }),
        onError: (e) => push({ tone: 'danger', title: 'Não foi possível gerar a exportação', description: mensagemDeErro(e, '') }),
      },
    )
  }

  return (
    <div className="relatorios-exportacoes">
      <h3 className="relatorios-exportacoes__titulo">Exportar em XLSX ou PDF</h3>
      <p className="relatorios-exportacoes__legenda">Usa os mesmos filtros acima. Fica pronto em alguns instantes — a lista atualiza sozinha.</p>
      <div className="relatorios-exportacoes__acoes">
        {(['xlsx', 'pdf'] as const).map((formato) => (
          <Button key={formato} variant="secondary" size="sm" onClick={() => gerar(formato)} disabled={criar.isPending}>
            {ROTULO_FORMATO[formato]}
          </Button>
        ))}
      </div>

      {exportacoes.data && exportacoes.data.results.length > 0 && (
        <ul className="relatorios-exportacoes__lista">
          {exportacoes.data.results.map((e) => {
            const status = ROTULO_STATUS[e.status]
            return (
              <li key={e.id} className="relatorios-exportacoes__item">
                <span className="relatorios-exportacoes__formato">{e.format.toUpperCase()}</span>
                <Tag tone={status.tom} dot>
                  {status.rotulo}
                </Tag>
                <span className="relatorios-exportacoes__quando">{formatarQuando(e.created_at)}</span>
                {e.status === 'done' && e.download_url ? (
                  <a className="btn btn--ghost btn--sm relatorios-exportacoes__baixar" href={urlBaixarExportacao(e.download_url)}>
                    <span className="btn__label">Baixar</span>
                  </a>
                ) : e.status === 'failed' ? (
                  <span className="relatorios-exportacoes__erro">{e.error || 'Erro ao gerar.'}</span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
