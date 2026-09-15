import { useId, useState } from 'react'
import type { Me } from '@/api/types'
import { formatarDataHora } from '../format'
import type { StatusTicket } from '../tipos'
import { useAcoesTicket } from './dados'
import { mensagemDeErro, paraDatetimeLocal } from './linhaDoTempo'
import type { TicketDetalhe } from './tiposDetalhe'

/** Só os dois que não mexem no registro de trabalho técnico (D4) — fechar
 *  ao enviar existe no backend (`schedule_reply` aceita `closed`), mas esta
 *  v1 não oferece: o agente que quer fechar já sabe quando terminou o
 *  trabalho, então é mais simples fechar na hora e só ADIAR o aviso — não
 *  faz parte do pedido original, fica para quando alguém precisar. */
const STATUS_AGENDAVEIS: ('open' | 'pending_customer')[] = ['open', 'pending_customer']

const ROTULO_STATUS_AGENDADO: Record<'open' | 'pending_customer', string> = {
  open: 'Aberto',
  pending_customer: 'Aguardando retorno do cliente',
}

interface Props {
  ticket: TicketDetalhe
  me: Me | undefined
}

/**
 * "Agendar resposta": escreve agora, o sistema dispara sozinho na hora
 * marcada (`apps.tickets.services.ticket_service.schedule_reply` +
 * `dispatch_scheduled_replies`, rodando a cada minuto). Pensado para quem
 * já sabe o que vai responder mas só quer que saia no próximo expediente —
 * "amanhã bem cedo", por exemplo — sem precisar estar na tela na hora.
 *
 * Ferramenta de agente: some para quem não pode responder publicamente
 * (mesma permissão de `Compositor`, `ticket.reply_public`) e para o
 * cliente, que nem recebe `scheduled_replies` do backend.
 */
export function AgendarResposta({ ticket, me }: Props) {
  const idBase = useId()
  const { agendarResposta, cancelarAgendamento } = useAcoesTicket(ticket.id)
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [status, setStatus] = useState<StatusTicket>('open')
  const [quando, setQuando] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  /** Piso do seletor, carimbado ao ABRIR o painel e não a cada render: ler o
   *  relógio durante o render é impuro (react-hooks/purity) e, pior, faria o
   *  mínimo rastejar para a frente enquanto a pessoa escreve — um horário
   *  escolhido às 14:00 viraria inválido sozinho no minuto seguinte. */
  const [minimo, setMinimo] = useState('')

  const perms = me?.permissions ?? []
  const podeAgendar = me?.is_internal === true && perms.includes('ticket.reply_public')
  const pendentes = ticket.scheduled_replies.filter((r) => r.status === 'pending')

  if (!podeAgendar) return null

  const podeConfirmar = texto.trim().length > 0 && quando.length > 0 && !agendarResposta.isPending

  function agendar() {
    if (!podeConfirmar) return
    setErro(null)
    agendarResposta.mutate(
      {
        body: texto.trim(),
        is_public: true,
        new_status: status,
        scheduled_at: new Date(quando).toISOString(),
      },
      {
        onSuccess: () => {
          setTexto('')
          setQuando('')
          setStatus('open')
          setAberto(false)
        },
        onError: (e) => setErro(mensagemDeErro(e, 'Não foi possível agendar.')),
      },
    )
  }

  return (
    <div className="agendar-resposta">
      {pendentes.length > 0 && (
        <ul className="agendar-resposta__lista" aria-label="Respostas agendadas">
          {pendentes.map((r) => (
            <li key={r.id} className="agendar-resposta__item">
              <i className="ti ti-clock" aria-hidden="true" />
              <span className="agendar-resposta__item-texto">
                <strong>{formatarDataHora(r.scheduled_at)}</strong>
                <span>{r.body}</span>
              </span>
              <button
                type="button"
                className="agendar-resposta__cancelar"
                disabled={cancelarAgendamento.isPending}
                onClick={() => cancelarAgendamento.mutate(r.id)}
              >
                Cancelar
              </button>
            </li>
          ))}
        </ul>
      )}

      {!aberto ? (
        <button
          type="button"
          className="agendar-resposta__abrir"
          onClick={() => {
            setMinimo(paraDatetimeLocal(new Date(Date.now() + 60_000).toISOString()))
            setAberto(true)
          }}
        >
          <i className="ti ti-calendar-time" aria-hidden="true" /> Agendar resposta
        </button>
      ) : (
        <div className="agendar-resposta__form">
          <label className="agendar-resposta__campo" htmlFor={`${idBase}-texto`}>
            Texto da resposta
          </label>
          <textarea
            id={`${idBase}-texto`}
            className="agendar-resposta__texto"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder="Escreva a resposta que vai sair sozinha na hora marcada…"
            autoFocus
          />
          <div className="agendar-resposta__linha">
            <span className="agendar-resposta__campo-inline">
              <label htmlFor={`${idBase}-quando`}>Quando</label>
              <input
                id={`${idBase}-quando`}
                type="datetime-local"
                value={quando}
                min={minimo}
                onChange={(e) => setQuando(e.target.value)}
              />
            </span>
            <span className="agendar-resposta__campo-inline">
              <label htmlFor={`${idBase}-status`}>Ao enviar, deixar</label>
              <select
                id={`${idBase}-status`}
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusTicket)}
              >
                {STATUS_AGENDAVEIS.map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_STATUS_AGENDADO[s]}
                  </option>
                ))}
              </select>
            </span>
          </div>
          {erro && (
            <p className="agendar-resposta__erro" role="alert">
              {erro}
            </p>
          )}
          <div className="agendar-resposta__acoes">
            <button
              type="button"
              className="agendar-resposta__cancelar-form"
              onClick={() => {
                setAberto(false)
                setErro(null)
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="agendar-resposta__confirmar"
              disabled={!podeConfirmar}
              onClick={agendar}
            >
              <i className="ti ti-calendar-time" aria-hidden="true" />
              {agendarResposta.isPending ? 'Agendando…' : 'Agendar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
