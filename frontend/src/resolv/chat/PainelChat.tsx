import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useChat,
  useConverterChat,
  useEquipes,
  useHistoricoDoCliente,
} from '@/api/chat'
import type { Me } from '@/api/types'
import { FormEncerrar, FormReabrir, FormTransferir, mensagemDe } from './acoes'
import { dataHoraDe } from './format'

type Acao = 'transferir' | 'converter' | 'encerrar' | 'reabrir' | null

const ROTULO_STATUS: Record<string, string> = {
  queued: 'na fila',
  active: 'em atendimento',
  closed: 'encerrado',
}

/**
 * Coluna da direita: quem é o cliente, quem atende, e as três ações de
 * ciclo de vida — transferir (direto pro outro agente, sem voltar à fila),
 * converter em chamado (a equipe entra AQUI, nunca na fila) e encerrar
 * (com a nota interna do agente, que o cliente nunca vê).
 */
export function PainelChat({ chatId, me }: { chatId: number; me: Me | undefined }) {
  const navigate = useNavigate()
  const { data: chat } = useChat(chatId)
  const { data: equipes } = useEquipes()
  const converter = useConverterChat(chatId)
  // Histórico da PESSOA (item 3): os atendimentos anteriores dela que este
  // agente pode ver — o recorte é do backend, não daqui.
  const [verHistorico, setVerHistorico] = useState(false)
  const { data: historico, isLoading: carregandoHistorico } = useHistoricoDoCliente(
    verHistorico ? (chat?.client_id ?? null) : null,
  )

  const [acao, setAcao] = useState<Acao>(null)
  const [equipeId, setEquipeId] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  if (!chat) return <aside className="cc-painel" />

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
        navigate(`/chamados/${c.ticket_id}`)
      },
      onError: (e) => setErro(mensagemDe(e, 'Não foi possível converter.')),
    })
  }

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
        <h3>
          Histórico do cliente
          <button
            type="button"
            className="cc-link cc-painel__ver-mais"
            aria-expanded={verHistorico}
            onClick={() => setVerHistorico((v) => !v)}
          >
            {verHistorico ? 'ocultar' : 'ver'}
          </button>
        </h3>
        {verHistorico && (
          carregandoHistorico ? (
            <p className="cc-painel__ajuda">Carregando…</p>
          ) : (historico ?? []).length <= 1 ? (
            <p className="cc-painel__ajuda">Este é o primeiro atendimento desta pessoa.</p>
          ) : (
            <ul className="cc-painel__historico">
              {(historico ?? [])
                .filter((h) => h.id !== chat.id)
                .map((h) => (
                  <li key={h.id}>
                    <button type="button" className="cc-painel__historico-item" onClick={() => navigate(`/chat?chat=${h.id}`)}>
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
          )
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
                <dd title="Interna — o cliente não vê">{chat.close_note}</dd>
              </>
            )}
            {chat.ticket_reference && (
              <>
                <dt>Chamado</dt>
                <dd>
                  <button type="button" className="cc-link" onClick={() => navigate(`/chamados/${chat.ticket_id}`)}>
                    {chat.ticket_reference}
                  </button>
                </dd>
              </>
            )}
            {chat.agent_score != null && (
              <>
                <dt>Nota interna</dt>
                <dd title="Só a equipe vê — nunca sai para o cliente">{chat.agent_score}/10 · interna</dd>
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

      {chat.status === 'closed' && me?.is_internal && (
        <section className="cc-painel__bloco cc-painel__acoes">
          <h3>Ações</h3>
          {acao === 'reabrir' ? (
            <FormReabrir chat={chat} onPronto={() => setAcao(null)} onCancelar={() => setAcao(null)} />
          ) : (
            <button type="button" onClick={() => abrir('reabrir')}>
              <i className="ti ti-rotate-clockwise" /> Reabrir conversa
            </button>
          )}
        </section>
      )}

      {podeAgir && (
        <section className="cc-painel__bloco cc-painel__acoes">
          <h3>Ações</h3>
          <button type="button" className={acao === 'transferir' ? 'cc-painel__acao--ativa' : ''} onClick={() => abrir('transferir')}>
            <i className="ti ti-arrows-left-right" /> Transferir
          </button>
          <button type="button" className={acao === 'converter' ? 'cc-painel__acao--ativa' : ''} onClick={() => abrir('converter')}>
            <i className="ti ti-ticket" /> Converter em chamado
          </button>
          <button type="button" className={acao === 'encerrar' ? 'cc-painel__acao--ativa' : ''} onClick={() => abrir('encerrar')}>
            <i className="ti ti-circle-x" /> Encerrar
          </button>

          {/* Os formulários são os MESMOS do mini chat (`./acoes`): uma regra
              só para transferir e encerrar, nas duas telas. */}
          {acao === 'transferir' && (
            <FormTransferir chat={chat} onPronto={() => setAcao(null)} />
          )}

          {acao === 'converter' && (
            <div className="cc-painel__form">
              <label htmlFor="cc-equipe">Equipe do chamado</label>
              <select id="cc-equipe" value={equipeId} onChange={(e) => setEquipeId(e.target.value)}>
                <option value="">Escolha a equipe</option>
                {(equipes ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="cc-painel__ajuda">
                O chat encerra, a transcrição inteira vira a primeira mensagem do chamado, e o cliente recebe o número.
              </p>
              <button type="button" className="cc-painel__confirmar" disabled={!equipeId || ocupado} onClick={confirmar}>
                {converter.isPending ? 'Convertendo…' : 'Converter'}
              </button>
            </div>
          )}

          {acao === 'encerrar' && (
            <FormEncerrar chat={chat} onPronto={() => setAcao(null)} />
          )}

          {erro && <p className="cc-painel__erro">{erro}</p>}
        </section>
      )}
    </aside>
  )
}
