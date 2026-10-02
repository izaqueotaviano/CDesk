import { useEffect, useState, type ReactNode } from 'react'
import { identidadeDe, tintaDeIdentidade } from '@/ui/identidade'
import { indiceDoPlano } from '@/ui/planos'
import { formatarDataHora } from '../format'
import { ICONE_CANAL, ROTULO_CANAL, ROTULO_SLA, TOM_SLA, iniciais, tempoSla } from './linhaDoTempo'
import { OutrosTicketsDoSolicitante } from './OutrosTicketsDoSolicitante'
import type { Avaliacao, RelogioSla, TicketDetalhe } from './tiposDetalhe'

const ROTULO_IDIOMA: Record<string, string> = {
  'pt-br': 'Português (Brasil)',
  'pt-BR': 'Português (Brasil)',
  en: 'Inglês',
  'en-us': 'Inglês (EUA)',
  es: 'Espanhol',
}

/** Hora local do cliente a partir do fuso da empresa (ex.: "qui., 10:55 BRT"). */
function horaLocal(timezone: string | null, agoraMs: number): string | null {
  if (!timezone) return null
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: timezone,
    }).format(new Date(agoraMs))
  } catch {
    return null
  }
}

function Linha({
  rotulo,
  children,
  vazio,
}: {
  rotulo: string
  children?: ReactNode
  vazio?: boolean
}) {
  return (
    <div className="cliente__linha">
      <dt className="cliente__rotulo">{rotulo}</dt>
      <dd className={'cliente__valor' + (vazio ? ' cliente__valor--vazio' : '')}>
        {children ?? '—'}
      </dd>
    </div>
  )
}

/** `rotulo` entra no aria-label: o botão é só ícone e agora serve mais de um
 *  dado, então "Copiar" sozinho não diria o quê. */
function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false)
  useEffect(() => {
    if (!copiado) return
    const h = setTimeout(() => setCopiado(false), 2000)
    return () => clearTimeout(h)
  }, [copiado])
  return (
    <button
      type="button"
      className={'cliente__copiar' + (copiado ? ' cliente__copiar--ok' : '')}
      onClick={() => {
        navigator.clipboard
          ?.writeText(texto)
          .then(() => setCopiado(true))
          .catch(() => {})
      }}
      aria-label={copiado ? `${rotulo} copiado` : `Copiar ${rotulo}`}
      title={copiado ? 'Copiado' : 'Copiar'}
    >
      <i className={copiado ? 'ti ti-check' : 'ti ti-copy'} aria-hidden="true" />
    </button>
  )
}

function LinhaSla({ rotulo, relogio }: { rotulo: string; relogio: RelogioSla }) {
  const tom = TOM_SLA[relogio.state]
  return (
    <div className={`cliente__sla cliente__sla--${tom}`}>
      <span className="cliente__sla-rotulo">{rotulo}</span>
      <span className="cliente__sla-valor">{tempoSla(relogio)}</span>
      <span className="cliente__sla-estado">{ROTULO_SLA[relogio.state]}</span>
      <span className="cliente__sla-prazo">
        {relogio.due_at ? `prazo ${formatarDataHora(relogio.due_at)}` : 'sem prazo definido'}
      </span>
    </div>
  )
}

/**
 * Nota do CSAT deste chamado. O docstring de `get_satisfaction`
 * (apps/tickets/serializers.py) diz para que ele existe: "quem atendeu nunca
 * via a avaliação que recebeu". Aqui é onde quem atendeu vê.
 *
 * O número NÃO é pintado por faixa. A escala é 0–10 e o backend só devolve
 * distribuição e média (`services/satisfaction.summarize`) — não existe corte
 * de "boa/ruim" definido em lugar nenhum, e inventar um aqui viraria uma
 * classificação que nenhum relatório usa. Cor neutra, o número fala.
 */
function BlocoAvaliacao({ avaliacao }: { avaliacao: Avaliacao }) {
  return (
    <span className="cliente__nota">
      <span className="cliente__nota-valor" aria-hidden="true">
        {avaliacao.score}
      </span>
      <span className="cliente__nota-corpo">
        <span className="cliente__nota-escala">Nota {avaliacao.score} de 10</span>
        {avaliacao.comment ? (
          <q className="cliente__nota-comentario">{avaliacao.comment}</q>
        ) : (
          <span className="cliente__nota-ajuda">Sem comentário</span>
        )}
        {avaliacao.responded_at && (
          <span className="cliente__nota-ajuda">
            respondida em {formatarDataHora(avaliacao.responded_at)}
          </span>
        )}
      </span>
    </span>
  )
}

/**
 * Painel do cliente — quem está do outro lado e o resumo objetivo deste
 * ticket (datas, solução, SLA). O histórico de status saiu daqui: ele agora
 * conta a história junto das mensagens, na conversa. A caixa "Observações"
 * desabilitada (sem endpoint por trás) também saiu — controle morto engana.
 */
export function PainelCliente({ ticket, agoraMs }: { ticket: TicketDetalhe; agoraMs: number }) {
  const req = ticket.requester
  const nome = req?.name ?? ticket.requester_display
  const hora = horaLocal(req?.timezone ?? null, agoraMs)
  const idioma = req ? (ROTULO_IDIOMA[req.ui_language] ?? req.ui_language) : null
  const reaberturas = ticket.reopen_count ?? 0
  // A pesquisa nasce no fechamento (services/satisfaction.create_for_ticket),
  // então antes disso "sem avaliação" não é informação — é cedo. Depois passa
  // a ser, e a linha aparece dizendo que a pesquisa segue sem resposta.
  const fechado = ticket.status === 'closed'

  return (
    <aside className="cliente" aria-label="Cliente e resumo do ticket">
      <header className="cliente__cabecalho">
        <span className="cliente__avatar" aria-hidden="true" {...identidadeDe(nome)}>
          {iniciais(nome)}
        </span>
        <div className="cliente__id">
          <span className="cliente__nome">{nome}</span>
          {ticket.company_name && <span className="cliente__empresa">{ticket.company_name}</span>}
        </div>
        {ticket.plan?.name && (
          <span
            className="cliente__plano"
            title="Plano da empresa"
            {...tintaDeIdentidade(indiceDoPlano(ticket.plan.name))}
          >
            {ticket.plan.name}
          </span>
        )}
      </header>

      <section className="cliente__grupo">
        <h2 className="cliente__titulo">Contato</h2>
        <dl className="cliente__lista">
          <Linha rotulo="E-mail" vazio={!req?.email}>
            {req?.email ? (
              <span className="cliente__copiavel">
                <a href={`mailto:${req.email}`} className="cliente__link">
                  {req.email}
                </a>
                <BotaoCopiar texto={req.email} rotulo="e-mail" />
              </span>
            ) : (
              '—'
            )}
          </Linha>
          <Linha rotulo="Hora local" vazio={!hora}>
            {hora}
          </Linha>
          <Linha rotulo="Idioma" vazio={!idioma}>
            {idioma}
          </Linha>
        </dl>
      </section>

      {/* Sem `requester.id` (conteúdo mascarado) não há de quem perguntar. */}
      {req?.id != null && <OutrosTicketsDoSolicitante ticket={ticket} />}

      <section className="cliente__grupo">
        <h2 className="cliente__titulo">Este ticket</h2>
        <dl className="cliente__lista">
          {/* Sempre visível, mesmo vazio: o número do pedido é a chave do ERP
              num B2B, e quem não o encontra aqui vai caçá-lo dentro da primeira
              mensagem. "Não informado" encerra a busca; a ausência da linha não. */}
          <Linha rotulo="Nº do pedido" vazio={!ticket.order_number}>
            {ticket.order_number ? (
              <span className="cliente__copiavel">
                <span className="cliente__pedido">{ticket.order_number}</span>
                <BotaoCopiar texto={ticket.order_number} rotulo="número do pedido" />
              </span>
            ) : (
              'não informado na abertura'
            )}
          </Linha>
          <Linha rotulo="Aberto em">{formatarDataHora(ticket.created_at)}</Linha>
          <Linha rotulo="Canal">
            <i className={ICONE_CANAL[ticket.source] ?? 'ti ti-mail'} aria-hidden="true" />{' '}
            {ROTULO_CANAL[ticket.source] ?? ticket.source}
          </Linha>
          <Linha rotulo="1ª resposta" vazio={!ticket.first_response_at}>
            {ticket.first_response_at
              ? formatarDataHora(ticket.first_response_at)
              : 'ainda sem resposta'}
          </Linha>
          {ticket.closed_at && (
            <Linha rotulo="Fechado em">{formatarDataHora(ticket.closed_at)}</Linha>
          )}
          {ticket.resolution_started_at && ticket.resolution_ended_at && (
            <Linha rotulo="Solução">
              {formatarDataHora(ticket.resolution_started_at)}
              <span className="cliente__ate"> até </span>
              {formatarDataHora(ticket.resolution_ended_at)}
            </Linha>
          )}
          {reaberturas > 0 && (
            <Linha rotulo="Reaberturas">
              {reaberturas}
              {ticket.last_reopened_at
                ? ` · última ${formatarDataHora(ticket.last_reopened_at)}`
                : ''}
            </Linha>
          )}
          {/* `satisfaction` nulo é "pesquisa não respondida", nunca nota zero —
              por isso o teste é no objeto, não no número (ver tiposDetalhe.ts). */}
          {ticket.satisfaction ? (
            <Linha rotulo="Avaliação">
              <BlocoAvaliacao avaliacao={ticket.satisfaction} />
            </Linha>
          ) : (
            fechado && (
              <Linha rotulo="Avaliação" vazio>
                pesquisa ainda sem resposta
              </Linha>
            )
          )}
        </dl>
      </section>

      <section className="cliente__grupo">
        <h2 className="cliente__titulo">SLA</h2>
        <LinhaSla rotulo="1ª resposta" relogio={ticket.sla.first_response} />
        <LinhaSla rotulo="Resolução" relogio={ticket.sla.resolution} />
        {(ticket.sla_cycle ?? 1) > 1 && (
          <p className="cliente__ajuda">
            Ciclo {ticket.sla_cycle}: o prazo de resolução recomeçou na reabertura.
          </p>
        )}
      </section>
    </aside>
  )
}
