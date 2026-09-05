import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useAgentes,
  useChat,
  useConverterChat,
  useEncerrarChat,
  useEquipes,
  useTransferirChat,
} from '@/api/chat'
import { ApiError } from '@/api/client'
import type { Me } from '@/api/types'
import { dataHoraDe } from './format'

type Acao = 'transferir' | 'converter' | 'encerrar' | null

const NOTAS = Array.from({ length: 11 }, (_, i) => i)

function mensagemDe(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0] ?? padrao) : padrao
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
  const { data: agentes } = useAgentes()
  const { data: equipes } = useEquipes()
  const transferir = useTransferirChat(chatId)
  const converter = useConverterChat(chatId)
  const encerrar = useEncerrarChat(chatId)

  const [acao, setAcao] = useState<Acao>(null)
  const [agenteId, setAgenteId] = useState('')
  const [equipeId, setEquipeId] = useState('')
  const [nota, setNota] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  if (!chat) return <aside className="cc-painel" />

  const souOAgente = me != null && chat.agent_id === me.id
  const podeAgir = chat.status === 'active' && (souOAgente || me?.is_admin === true)
  const ocupado = transferir.isPending || converter.isPending || encerrar.isPending

  function abrir(a: Acao) {
    setErro(null)
    setAcao((atual) => (atual === a ? null : a))
  }

  function confirmar() {
    setErro(null)
    if (acao === 'transferir') {
      if (!agenteId) return
      transferir.mutate(Number(agenteId), {
        onSuccess: () => setAcao(null),
        onError: (e) => setErro(mensagemDe(e, 'Não foi possível transferir.')),
      })
    } else if (acao === 'converter') {
      if (!equipeId) return
      converter.mutate(Number(equipeId), {
        onSuccess: (c) => {
          setAcao(null)
          navigate(`/chamados/${c.ticket_id}`)
        },
        onError: (e) => setErro(mensagemDe(e, 'Não foi possível converter.')),
      })
    } else if (acao === 'encerrar') {
      encerrar.mutate(nota === '' ? null : Number(nota), {
        onSuccess: () => setAcao(null),
        onError: (e) => setErro(mensagemDe(e, 'Não foi possível encerrar.')),
      })
    }
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

      {chat.status === 'closed' && (
        <section className="cc-painel__bloco">
          <h3>Desfecho</h3>
          <dl>
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

          {acao === 'transferir' && (
            <div className="cc-painel__form">
              <label htmlFor="cc-agente">Para quem</label>
              <select id="cc-agente" value={agenteId} onChange={(e) => setAgenteId(e.target.value)}>
                <option value="">Escolha um agente</option>
                {(agentes ?? [])
                  .filter((a) => a.id !== chat.agent_id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name}
                      {a.presence === 'available' ? '' : ` (${a.presence === 'away' ? 'ausente' : 'offline'})`}
                    </option>
                  ))}
              </select>
              <p className="cc-painel__ajuda">Vai direto pro agente escolhido — não volta pra fila.</p>
              <button type="button" className="cc-painel__confirmar" disabled={!agenteId || ocupado} onClick={confirmar}>
                {transferir.isPending ? 'Transferindo…' : 'Transferir'}
              </button>
            </div>
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
            <div className="cc-painel__form">
              <label htmlFor="cc-nota">Nota interna do atendimento (opcional)</label>
              <select id="cc-nota" value={nota} onChange={(e) => setNota(e.target.value)}>
                <option value="">Sem nota</option>
                {NOTAS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <p className="cc-painel__ajuda">Só a equipe vê esta nota — ela nunca sai para o cliente.</p>
              <button type="button" className="cc-painel__confirmar cc-painel__confirmar--perigo" disabled={ocupado} onClick={confirmar}>
                {encerrar.isPending ? 'Encerrando…' : 'Encerrar conversa'}
              </button>
            </div>
          )}

          {erro && <p className="cc-painel__erro">{erro}</p>}
        </section>
      )}
    </aside>
  )
}
