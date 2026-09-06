import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { ColunaOrdenavel, RelogioSla, TicketLinha } from './tipos'
import {
  COR_PRIORIDADE,
  ROTULO_PRIORIDADE,
  ROTULO_STATUS,
  corEstadoSla,
  esperaEmFila,
  formatarDataHora,
  rotuloAbrirChamado,
  textoEstadoSla,
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
  // O prazo já vinha em toda linha (`sla` no TicketListSerializer) e a fila
  // era a única tela que não o mostrava — quem decide o que atender AGORA
  // abria chamado a chamado pra achar o que está estourando.
  { chave: 'sla', rotulo: 'SLA', className: 'col-sla' },
  { chave: 'justificativa', rotulo: 'Justificativa', className: 'col-just' },
  { chave: 'espera', rotulo: 'Tempo de espera em fila', className: 'col-espera' },
]

/** Data cheia no `title` — a célula só cabe o estado ("2h restantes"), e o
 *  instante do vencimento é o que a pessoa confere antes de prometer algo ao
 *  cliente. Mesma frase do cabeçalho do detalhe (CabecalhoTicket.tsx). */
function tituloPrazo(sla: RelogioSla): string {
  return sla.due_at ? `Prazo: ${formatarDataHora(sla.due_at)}` : 'Sem prazo definido'
}

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
  // A caixa do cabeçalho age sobre a PÁGINA (as linhas renderizadas), nunca
  // sobre os `count` do backend — por isso ela conta só o que está na tela e
  // o rótulo diz o número. Com parte marcada, o estado é indeterminado: sem
  // ele, "3 de 25 marcados" desenhava exatamente igual a "nada marcado".
  const marcadasNaPagina = linhas.reduce((n, l) => (selecionados.has(l.id) ? n + 1 : n), 0)
  const todosMarcados = linhas.length > 0 && marcadasNaPagina === linhas.length
  const parcial = marcadasNaPagina > 0 && !todosMarcados
  const refTodos = useRef<HTMLInputElement>(null)

  // `indeterminate` só existe como propriedade do DOM, não como atributo —
  // daí o ref. O Checkbox do cvz resolve isso pronto, mas pinta com `--cvz-*`,
  // que não é garantido sob o shell Resolv (detalhe.scss registra a mesma
  // pegadinha com o Modal): trocar o input nativo aqui apagaria a caixa.
  useEffect(() => {
    if (refTodos.current) refTodos.current.indeterminate = parcial
  }, [parcial])

  const rotuloTodos =
    linhas.length === 1
      ? 'Selecionar o ticket desta página'
      : `Selecionar os ${linhas.length} tickets desta página`

  return (
    <div className="tickets-tabela__wrap">
      <table className="tickets-tabela">
        <thead>
          <tr>
            <th className="col-check">
              <input
                ref={refTodos}
                type="checkbox"
                aria-label={rotuloTodos}
                title={rotuloTodos}
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
                {/* O <label> em volta é o ALVO: a caixa continua com 16px de
                    desenho, mas a área clicável passa a ter 24px (WCAG 2.5.8)
                    sem depender da exceção de espaçamento — que aqui não valeria,
                    porque a linha inteira também é clicável e envolve a caixa. */}
                <label className="col-check__alvo">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${t.reference}`}
                    checked={selecionados.has(t.id)}
                    onChange={() => onSelecionar(t.id)}
                  />
                </label>
              </td>
              {/* Item 26: <tr onClick> sozinho não é alcançável por teclado (a
                  linha não tem tabIndex/role, e as células são <span>) — quem
                  tabula pelas 25 caixas de seleção nunca chega ao chamado.
                  Um <Link> de verdade é ADICIONAL ao clique na linha (mouse
                  continua indo em qualquer ponto dela): dá parada de Tab,
                  Enter ativa, e o leitor de tela anuncia "link". Não é a
                  linha inteira virando link (stretched link) — em <tr>/<td>
                  essa técnica quebra de formas sutis (área clicável some
                  atrás de outra célula, sobreposição com o próprio link),
                  então só a célula do protocolo. `stopPropagation` no mesmo
                  padrão da célula do checkbox logo acima: sem ele, clicar no
                  link também dispararia o onClick da linha por baixo — dois
                  disparos do mesmo destino em sequência. */}
              <td className="col-protocolo" onClick={(e) => e.stopPropagation()}>
                <Link
                  to={`/chamados/${t.id}`}
                  className="tickets-tabela__ref"
                  aria-label={rotuloAbrirChamado(t)}
                >
                  {t.reference}
                </Link>
              </td>
              <td className="col-assunto">
                <span className="tickets-tabela__assunto" title={t.subject}>
                  {t.is_restricted && (
                    <>
                      {/* Ícone sozinho não tem nome: `<i>` sem role tem papel
                          implícito "generic", que não recebe nome de autor
                          (mesmo defeito do `aria-label` na barra de urgência
                          logo abaixo) — daí o texto real ao lado, só recortado
                          da tela. TEXTO FIXO, não `restriction_reason`: para
                          usuário interno esse campo do backend chega sempre
                          vazio (`is_content_visible_to` libera tudo que ele
                          enxerga — a máscara é regra do portal, não daqui, ver
                          `_busca_q` em apps/tickets/views.py), então declarar
                          o campo prometeria um texto que esta tela nunca
                          teria pra mostrar. */}
                      <i className="ti ti-lock tickets-tabela__cadeado" aria-hidden="true" />
                      <span className="tickets-tabela__sr">Equipe restrita: visível só para quem abriu. </span>
                    </>
                  )}
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
              {/* Item 27: a barra colorida sozinha falha WCAG 1.4.1 (cor não
                  pode ser o único jeito de saber a prioridade — daltonismo
                  não distingue) e o `aria-label` antigo, num <span> sem role
                  (papel implícito "generic"), não tem nome de autor exposto
                  — o leitor de tela não ouvia nada. Visualmente continua só
                  a barra (o `title` cobre quem passa o mouse); o nome
                  acessível vem de ROTULO_PRIORIDADE num texto real ao lado,
                  só recortado da tela — não de um atributo que este elemento
                  não consegue expor. */}
              <td className="col-urg">
                <span
                  className="tickets-tabela__urg"
                  style={{ background: COR_PRIORIDADE[t.priority] }}
                  title={ROTULO_PRIORIDADE[t.priority]}
                  aria-hidden="true"
                />
                <span className="tickets-tabela__sr">{ROTULO_PRIORIDADE[t.priority]}</span>
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
              {/* Relógio de RESOLUÇÃO, não o de 1ª resposta: é por
                  `sla_resolution_due_at` que `?ordering=sla` ordena
                  (ALLOWED_ORDERING em apps/tickets/views.py) — coluna que
                  mostra um prazo e ordena por outro mente no clique. */}
              <td className="col-sla">
                <span
                  className="tickets-tabela__sla"
                  style={{ color: corEstadoSla(t.sla.resolution) }}
                  title={tituloPrazo(t.sla.resolution)}
                >
                  {textoEstadoSla(t.sla.resolution)}
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
