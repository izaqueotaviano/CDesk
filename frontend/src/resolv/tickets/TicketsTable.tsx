import type { ColunaOrdenavel, TicketLinha } from './tipos'
import {
  COR_PRIORIDADE,
  ROTULO_PRIORIDADE,
  ROTULO_STATUS,
  esperaEmFila,
  formatarDataHora,
} from './format'

interface Coluna {
  chave: ColunaOrdenavel | null
  rotulo: string
  className?: string
}

const COLUNAS: Coluna[] = [
  { chave: 'reference', rotulo: 'Protocolo', className: 'col-protocolo' },
  { chave: 'subject', rotulo: 'Assunto', className: 'col-assunto' },
  { chave: 'criado', rotulo: 'Aberto em', className: 'col-data' },
  { chave: 'cliente', rotulo: 'Cliente (Completo)', className: 'col-cliente' },
  { chave: 'responsavel', rotulo: 'Responsável', className: 'col-resp' },
  { chave: 'categoria', rotulo: 'Categoria', className: 'col-cat' },
  { chave: 'urgencia', rotulo: 'Urgência', className: 'col-urg' },
  { chave: 'status', rotulo: 'Status', className: 'col-status' },
  { chave: 'justificativa', rotulo: 'Justificativa', className: 'col-just' },
  { chave: 'espera', rotulo: 'Tempo de espera em fila', className: 'col-espera' },
]

interface Props {
  linhas: TicketLinha[]
  ordering: string
  onOrdenar: (chave: ColunaOrdenavel) => void
  selecionados: Set<number>
  onSelecionar: (id: number) => void
  onSelecionarTodos: (marcar: boolean) => void
  onAbrir: (id: number) => void
  agoraMs: number
}

export function TicketsTable({
  linhas,
  ordering,
  onOrdenar,
  selecionados,
  onSelecionar,
  onSelecionarTodos,
  onAbrir,
  agoraMs,
}: Props) {
  const campoAtual = ordering.replace(/^-/, '')
  const desc = ordering.startsWith('-')
  const todosMarcados = linhas.length > 0 && linhas.every((l) => selecionados.has(l.id))

  return (
    <div className="tickets-tabela__wrap">
      <table className="tickets-tabela">
        <thead>
          <tr>
            <th className="col-check">
              <input
                type="checkbox"
                aria-label="Selecionar todos"
                checked={todosMarcados}
                onChange={(e) => onSelecionarTodos(e.target.checked)}
              />
            </th>
            {COLUNAS.map((c) => {
              const ativo = c.chave === campoAtual
              return (
                <th key={c.rotulo} className={c.className}>
                  {c.chave ? (
                    <button
                      type="button"
                      className={'tickets-tabela__sort' + (ativo ? ' tickets-tabela__sort--ativo' : '')}
                      onClick={() => onOrdenar(c.chave as ColunaOrdenavel)}
                    >
                      {c.rotulo}
                      <i
                        className={
                          ativo
                            ? desc
                              ? 'ti ti-arrow-down'
                              : 'ti ti-arrow-up'
                            : 'ti ti-arrows-up-down'
                        }
                      />
                    </button>
                  ) : (
                    c.rotulo
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {linhas.map((t) => (
            <tr key={t.id} onClick={() => onAbrir(t.id)}>
              <td className="col-check" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Selecionar ${t.reference}`}
                  checked={selecionados.has(t.id)}
                  onChange={() => onSelecionar(t.id)}
                />
              </td>
              <td className="col-protocolo">
                <span className="tickets-tabela__ref">{t.reference}</span>
              </td>
              <td className="col-assunto">
                <span className="tickets-tabela__assunto" title={t.subject}>
                  {t.is_restricted && <i className="ti ti-lock tickets-tabela__cadeado" />}
                  {t.subject}
                </span>
              </td>
              <td className="col-data tickets-tabela__mono-muted">{formatarDataHora(t.created_at)}</td>
              <td className="col-cliente">
                <span className="tickets-tabela__cliente" title={t.requester_display}>
                  {t.requester_display}
                </span>
                {t.company_name && <span className="tickets-tabela__empresa">{t.company_name}</span>}
              </td>
              <td className="col-resp">{t.assignee_name ?? <span className="tickets-tabela__vazio">—</span>}</td>
              <td className="col-cat">{t.category_name ?? <span className="tickets-tabela__vazio">—</span>}</td>
              <td className="col-urg">
                <span
                  className="tickets-tabela__urg"
                  style={{ background: COR_PRIORIDADE[t.priority] }}
                  title={ROTULO_PRIORIDADE[t.priority]}
                  aria-label={ROTULO_PRIORIDADE[t.priority]}
                />
              </td>
              <td className="col-status">
                <span className="tickets-tabela__status">
                  <span
                    className="tickets-tabela__status-dot"
                    style={{ background: t.stage_color || 'var(--text-muted)' }}
                  />
                  {t.stage_name || ROTULO_STATUS[t.status]}
                </span>
              </td>
              <td className="col-just">
                {t.current_status_note ? (
                  <span className="tickets-tabela__just" title={t.current_status_note}>
                    {t.current_status_note}
                  </span>
                ) : (
                  <span className="tickets-tabela__vazio">—</span>
                )}
              </td>
              <td className="col-espera tickets-tabela__mono-muted">
                {esperaEmFila(t.created_at, t.first_response_at, agoraMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
