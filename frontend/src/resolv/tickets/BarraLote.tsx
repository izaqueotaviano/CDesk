import type { Agente } from '@/api/chat'
import { ROTULO_PRIORIDADE } from './format'
import type { Prioridade, StatusDoQuadro } from './tipos'

const PRIORIDADES: Prioridade[] = ['low', 'normal', 'high', 'urgent']

interface Props {
  quantidade: number
  /** `ticket.bulk_actions`: sem ela a barra só conta e limpa. */
  podeLote: boolean
  /** `ticket.close`: "Encerrar" some para quem não fecha chamado. */
  podeEncerrar: boolean
  agentes: Agente[]
  status: StatusDoQuadro[]
  pendente: boolean
  onAtribuir: (assigneeId: number | null) => void
  onPrioridade: (p: Prioridade) => void
  onStatus: (stageId: number) => void
  onEncerrar: () => void
  onLimpar: () => void
}

/**
 * Barra de seleção múltipla. `<select>` nativo para as escolhas de uma
 * lista (atribuir, prioridade, status): no celular abre o seletor do
 * sistema, e no teclado é o controle que todo mundo já sabe usar.
 * "Encerrar" é botão porque abre o diálogo das datas de solução.
 */
export function BarraLote({
  quantidade,
  podeLote,
  podeEncerrar,
  agentes,
  status,
  pendente,
  onAtribuir,
  onPrioridade,
  onStatus,
  onEncerrar,
  onLimpar,
}: Props) {
  return (
    <div className="lista-tickets__lote" role="region" aria-label="Ações em lote">
      <span className="lista-tickets__lote-contagem">
        <strong>{quantidade}</strong> {quantidade === 1 ? 'selecionado' : 'selecionados'}
      </span>
      {podeLote && (
        <div className="lista-tickets__lote-acoes">
          <select
            className="lista-tickets__lote-select"
            aria-label="Atribuir selecionados"
            value=""
            disabled={pendente}
            onChange={(e) => {
              const v = e.target.value
              if (v) onAtribuir(v === 'ninguem' ? null : Number(v))
            }}
          >
            <option value="">Atribuir a…</option>
            <option value="ninguem">Ninguém</option>
            {agentes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
          </select>
          <select
            className="lista-tickets__lote-select"
            aria-label="Mudar prioridade dos selecionados"
            value=""
            disabled={pendente}
            onChange={(e) => {
              const v = e.target.value
              if (v) onPrioridade(v as Prioridade)
            }}
          >
            <option value="">Mudar prioridade…</option>
            {PRIORIDADES.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PRIORIDADE[p]}
              </option>
            ))}
          </select>
          <select
            className="lista-tickets__lote-select"
            aria-label="Mudar status dos selecionados"
            value=""
            disabled={pendente || status.length === 0}
            onChange={(e) => {
              const v = e.target.value
              if (v) onStatus(Number(v))
            }}
          >
            <option value="">Mudar status…</option>
            {status.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {podeEncerrar && (
            <button
              type="button"
              className="lista-tickets__botao lista-tickets__botao--secundario"
              disabled={pendente}
              onClick={onEncerrar}
            >
              <i className="ti ti-circle-check" aria-hidden="true" />
              Encerrar
            </button>
          )}
          {pendente && (
            <i className="ti ti-loader-2 lista-tickets__spin" aria-label="Aplicando…" role="img" />
          )}
        </div>
      )}
      <button type="button" className="lista-tickets__lote-limpar" onClick={onLimpar}>
        Limpar seleção
      </button>
    </div>
  )
}
