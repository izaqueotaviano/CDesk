import { useEffect, useState, type ReactNode } from 'react'
import { formatarDataHora } from '../format'
import { ICONE_CANAL, ROTULO_CANAL, ROTULO_SLA, TOM_SLA, iniciais, tempoSla } from './linhaDoTempo'
import type { RelogioSla, TicketDetalhe } from './tiposDetalhe'

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

function BotaoCopiar({ texto }: { texto: string }) {
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
      aria-label={copiado ? 'E-mail copiado' : 'Copiar e-mail'}
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

  return (
    <aside className="cliente" aria-label="Cliente e resumo do ticket">
      <header className="cliente__cabecalho">
        <span className="cliente__avatar" aria-hidden="true">
          {iniciais(nome)}
        </span>
        <div className="cliente__id">
          <span className="cliente__nome">{nome}</span>
          {ticket.company_name && <span className="cliente__empresa">{ticket.company_name}</span>}
        </div>
        {ticket.plan?.name && (
          <span className="cliente__plano" title="Plano da empresa">
            {ticket.plan.name}
          </span>
        )}
      </header>

      <section className="cliente__grupo">
        <h2 className="cliente__titulo">Contato</h2>
        <dl className="cliente__lista">
          <Linha rotulo="E-mail" vazio={!req?.email}>
            {req?.email ? (
              <span className="cliente__email">
                <a href={`mailto:${req.email}`} className="cliente__link">
                  {req.email}
                </a>
                <BotaoCopiar texto={req.email} />
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

      <section className="cliente__grupo">
        <h2 className="cliente__titulo">Este ticket</h2>
        <dl className="cliente__lista">
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
        </dl>
      </section>

      <section className="cliente__grupo">
        <h2 className="cliente__titulo">SLA</h2>
        <LinhaSla rotulo="1ª resposta" relogio={ticket.sla.first_response} />
        <LinhaSla rotulo="Resolução" relogio={ticket.sla.resolution} />
        {(ticket.sla_cycle ?? 1) > 1 && (
          <p className="cliente__ajuda">
            Ciclo {ticket.sla_cycle} — o prazo de resolução recomeçou na reabertura.
          </p>
        )}
      </section>
    </aside>
  )
}
