import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  baixarTranscricao,
  useChat,
  useConverterChat,
  useEquipes,
  useHistoricoDoCliente,
} from '@/api/chat'
import { ApiError } from '@/api/client'
import type { Me } from '@/api/types'
import { FormEncerrar, FormReabrir, FormTransferir, mensagemDe } from './acoes'
import { EsqueletoLista, EsqueletoPainel } from './Esqueletos'
import { dataHoraDe } from './format'

type Acao = 'transferir' | 'converter' | 'encerrar' | 'reabrir' | null

const ROTULO_STATUS: Record<string, string> = {
  queued: 'na fila',
  active: 'em atendimento',
  closed: 'encerrado',
}

/**
 * Coluna da direita (ou a folha "Detalhes do cliente" abaixo de 1200px):
 * quem é o cliente, quem atende, e as ações de ciclo de vida — transferir
 * (direto pro outro agente, sem voltar à fila), converter em chamado (a
 * equipe entra AQUI, nunca na fila) e encerrar (com a nota interna do
 * agente, que o cliente nunca vê).
 *
 * As ações são BOTÕES de verdade, agrupados, no estilo secundário; o
 * "Encerrar" se diferencia pela cor do texto (é destrutivo) sem gritar mais
 * que os outros. O que cada um abre aparece logo abaixo do grupo.
 */
export function PainelChat({ chatId, me }: { chatId: number; me: Me | undefined }) {
  const navigate = useNavigate()
  const { data: chat, isLoading, isError, refetch } = useChat(chatId)
  const { data: equipes } = useEquipes()
  const converter = useConverterChat(chatId)
  // Histórico da PESSOA (item 3): os atendimentos anteriores dela que este
  // agente pode ver — o recorte é do backend, não daqui.
  const [verHistorico, setVerHistorico] = useState(false)
  const historico = useHistoricoDoCliente(verHistorico ? (chat?.client_id ?? null) : null)

  const [acao, setAcao] = useState<Acao>(null)
  const [equipeId, setEquipeId] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [baixando, setBaixando] = useState(false)
  const [erroExport, setErroExport] = useState<string | null>(null)

  async function baixar(id: number, comNotas: boolean) {
    setErroExport(null)
    setBaixando(true)
    try {
      await baixarTranscricao(id, comNotas)
    } catch (e) {
      setErroExport(
        e instanceof ApiError
          ? (e.detail ?? 'Não foi possível exportar.')
          : 'Não foi possível exportar.',
      )
    } finally {
      setBaixando(false)
    }
  }

  if (!chat) {
    return (
      <aside className="cc-painel" aria-label="Detalhes do atendimento" aria-busy={isLoading}>
        {isError && !isLoading ? (
          <div className="cc-painel__bloco">
            <p className="cc-painel__erro" role="alert">
              Não foi possível carregar os detalhes.{' '}
              <button type="button" className="cc-link" onClick={() => void refetch?.()}>
                Tentar de novo
              </button>
            </p>
          </div>
        ) : (
          <EsqueletoPainel />
        )}
      </aside>
    )
  }

  const souOAgente = me != null && chat.agent_id === me.id
  const podeAgir = chat.status === 'active' && (souOAgente || me?.is_admin === true)
  // Transferir e encerrar viraram `FormTransferir`/`FormEncerrar` (./acoes),
  // compartilhados com o mini chat — aqui sobrou só a conversão em chamado,
  // que é exclusiva do console (a equipe do ticket entra nela).
  const ocupado = converter.isPending

  function abrir(a: Acao) {
    setErro(null)
    setAcao((atual) => (atual === a ? null : a))
  }

  function confirmar() {
    setErro(null)
    if (acao !== 'converter' || !equipeId) return
    converter.mutate(Number(equipeId), {
      onSuccess: (c) => {
        setAcao(null)
        navigate(`/tickets/${c.ticket_id}`)
      },
      onError: (e) => setErro(mensagemDe(e, 'Não foi possível converter.')),
    })
  }

  /** Um botão de ação que abre (e fecha) o formulário dele logo abaixo.
   *  Função que devolve JSX, não componente: um componente declarado aqui
   *  dentro mudaria de identidade a cada render e o botão perderia o foco
   *  justamente no clique que abre o formulário. */
  function botaoDeAcao(qual: Exclude<Acao, null>, icone: string, rotulo: string, perigo = false) {
    return (
      <button
        type="button"
        className={'cc-botao cc-botao--bloco' + (perigo ? ' cc-botao--perigo' : '')}
        aria-expanded={acao === qual}
        onClick={() => abrir(qual)}
      >
        <i className={'ti ' + icone} aria-hidden="true" /> {rotulo}
      </button>
    )
  }

  const anteriores = (historico.data ?? []).filter((h) => h.id !== chat.id)

  return (
    <aside className="cc-painel" aria-label="Detalhes do atendimento">
      <section className="cc-painel__bloco">
        <h3>Cliente</h3>
        <dl>
          <dt>Nome</dt>
          <dd>{chat.client_name}</dd>
          <dt>Empresa</dt>
          <dd>{chat.company_name}</dd>
          {chat.client_email && (
            <>
              <dt>E-mail</dt>
              <dd>{chat.client_email}</dd>
            </>
          )}
          {chat.client_phone && (
            <>
              <dt>Telefone</dt>
              <dd>{chat.client_phone}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="cc-painel__bloco">
        <h3>Atendimento</h3>
        <dl>
          <dt>Protocolo</dt>
          <dd>#{chat.id}</dd>
          <dt>Entrou na fila</dt>
          <dd>{dataHoraDe(chat.queued_at)}</dd>
          <dt>Atendido por</dt>
          <dd>{chat.agent_name ?? '—'}</dd>
          <dt>Aceito em</dt>
          <dd>{dataHoraDe(chat.accepted_at)}</dd>
          {chat.closed_at && (
            <>
              <dt>Encerrado em</dt>
              <dd>{dataHoraDe(chat.closed_at)}</dd>
            </>
          )}
          {chat.reopen_count > 0 && (
            <>
              <dt>Reaberturas</dt>
              <dd>{chat.reopen_count}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="cc-painel__bloco">
        <div className="cc-painel__titulo-linha">
          <h3 id={`cc-hist-${chat.id}`}>Histórico do cliente</h3>
          <button
            type="button"
            className="cc-botao cc-botao--discreto"
            aria-expanded={verHistorico}
            aria-controls={`cc-hist-lista-${chat.id}`}
            onClick={() => setVerHistorico((v) => !v)}
          >
            {verHistorico ? 'Ocultar' : 'Ver atendimentos'}
            <i className={'ti ' + (verHistorico ? 'ti-chevron-up' : 'ti-chevron-down')} aria-hidden="true" />
          </button>
        </div>
        {verHistorico && (
          <div id={`cc-hist-lista-${chat.id}`}>
            {historico.isLoading ? (
              <EsqueletoLista linhas={2} rotulo="Carregando o histórico" />
            ) : historico.isError ? (
              <p className="cc-painel__erro" role="alert">
                Não foi possível carregar o histórico.{' '}
                <button type="button" className="cc-link" onClick={() => void historico.refetch()}>
                  Tentar de novo
                </button>
              </p>
            ) : anteriores.length === 0 ? (
              <p className="cc-painel__ajuda">Este é o primeiro atendimento desta pessoa.</p>
            ) : (
              <ul className="cc-painel__historico">
                {anteriores.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="cc-painel__historico-item"
                      onClick={() => navigate(`/chat?chat=${h.id}`)}
                    >
                      <span className="cc-painel__historico-topo">
                        <span className="cc-painel__historico-protocolo">#{h.id}</span>
                        <span>{dataHoraDe(h.closed_at ?? h.queued_at)}</span>
                      </span>
                      <span className="cc-painel__historico-meta">
                        {ROTULO_STATUS[h.status]}
                        {h.agent_name ? ` · ${h.agent_name}` : ''}
                        {h.close_reason_name ? ` · ${h.close_reason_name}` : ''}
                        {h.rating ? ` · nota ${h.rating.service_score}` : ''}
                        {h.reopen_count > 0 ? ` · ${h.reopen_count} reabertura(s)` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {chat.status === 'closed' && (
        <section className="cc-painel__bloco">
          <h3>Desfecho</h3>
          <dl>
            <dt>Encerrado por</dt>
            <dd>
              {chat.closed_automatically
                ? 'automaticamente'
                : (chat.closed_by_name ?? '—')}
            </dd>
            {chat.close_reason_name && (
              <>
                <dt>Motivo</dt>
                <dd>{chat.close_reason_name}</dd>
              </>
            )}
            {chat.close_note && (
              <>
                <dt>Observação</dt>
                <dd title="Interna, o cliente não vê">{chat.close_note}</dd>
              </>
            )}
            {chat.ticket_reference && (
              <>
                <dt>Ticket</dt>
                <dd>
                  <button type="button" className="cc-link" onClick={() => navigate(`/tickets/${chat.ticket_id}`)}>
                    {chat.ticket_reference}
                  </button>
                </dd>
              </>
            )}
            {chat.agent_score != null && (
              <>
                <dt>Nota interna</dt>
                <dd title="Só a equipe vê, nunca sai para o cliente">{chat.agent_score}/10 · interna</dd>
              </>
            )}
            <dt>Avaliação do cliente</dt>
            <dd>
              {chat.rating
                ? `atendimento ${chat.rating.service_score} · resolução ${chat.rating.resolution_score}`
                : chat.rating_pending
                  ? 'pendente'
                  : '—'}
            </dd>
          </dl>
        </section>
      )}

      {podeAgir && (
        <section className="cc-painel__bloco" aria-labelledby={`cc-acoes-${chat.id}`}>
          <h3 id={`cc-acoes-${chat.id}`}>Ações</h3>
          <div className="cc-painel__botoes">
            {botaoDeAcao('transferir', 'ti-arrows-left-right', 'Transferir')}
            {botaoDeAcao('converter', 'ti-ticket', 'Converter em ticket')}
            {botaoDeAcao('encerrar', 'ti-circle-x', 'Encerrar', true)}
          </div>

          {/* Os formulários são os MESMOS do mini chat (`./acoes`): uma regra
              só para transferir e encerrar, nas duas telas. */}
          {acao === 'transferir' && (
            <div className="cc-painel__form">
              <FormTransferir chat={chat} onPronto={() => setAcao(null)} onCancelar={() => setAcao(null)} />
            </div>
          )}

          {acao === 'converter' && (
            <div className="cc-painel__form cc-acao">
              <label htmlFor="cc-equipe">Equipe do ticket</label>
              <select id="cc-equipe" value={equipeId} onChange={(e) => setEquipeId(e.target.value)}>
                <option value="">Escolha a equipe</option>
                {(equipes ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="cc-acao__ajuda">
                O chat encerra, a transcrição inteira vira a primeira mensagem do ticket, e o cliente recebe o número.
              </p>
              {erro && (
                <p className="cc-acao__erro" role="alert">
                  {erro}
                </p>
              )}
              <div className="cc-acao__botoes">
                <button type="button" className="cc-acao__cancelar" onClick={() => setAcao(null)} disabled={ocupado}>
                  Cancelar
                </button>
                <button type="button" className="cc-acao__confirmar" disabled={!equipeId || ocupado} onClick={confirmar}>
                  {converter.isPending ? 'Convertendo…' : 'Converter'}
                </button>
              </div>
            </div>
          )}

          {acao === 'encerrar' && (
            <div className="cc-painel__form">
              <FormEncerrar chat={chat} onPronto={() => setAcao(null)} onCancelar={() => setAcao(null)} />
            </div>
          )}
        </section>
      )}

      {chat.status === 'closed' && me?.is_internal && (
        <section className="cc-painel__bloco" aria-labelledby={`cc-acoes-${chat.id}`}>
          <h3 id={`cc-acoes-${chat.id}`}>Ações</h3>
          {acao === 'reabrir' ? (
            <div className="cc-painel__form">
              <FormReabrir chat={chat} onPronto={() => setAcao(null)} onCancelar={() => setAcao(null)} />
            </div>
          ) : (
            <div className="cc-painel__botoes">
              {botaoDeAcao('reabrir', 'ti-rotate-clockwise', 'Reabrir conversa')}
            </div>
          )}
        </section>
      )}

      {me?.is_internal && (
        <section className="cc-painel__bloco" aria-labelledby={`cc-transc-${chat.id}`}>
          <h3 id={`cc-transc-${chat.id}`}>Transcrição</h3>
          {/* Duas opções e não uma caixinha: a diferença entre os dois
              arquivos é grande demais para depender de alguém notar um
              checkbox marcado. O que leva notas se identifica como interno
              no próprio rodapé. */}
          <div className="cc-painel__botoes">
            <button type="button" className="cc-botao cc-botao--bloco" disabled={baixando} onClick={() => baixar(chat.id, false)}>
              <i className="ti ti-file-download" aria-hidden="true" /> Exportar PDF
            </button>
            <button type="button" className="cc-botao cc-botao--bloco" disabled={baixando} onClick={() => baixar(chat.id, true)}>
              <i className="ti ti-lock" aria-hidden="true" /> Exportar com notas internas
            </button>
          </div>
          <p className="cc-painel__ajuda">O PDF com notas é de uso interno. Não envie ao cliente.</p>
          {erroExport && (
            <p className="cc-painel__erro" role="alert">
              {erroExport}
            </p>
          )}
        </section>
      )}
    </aside>
  )
}
