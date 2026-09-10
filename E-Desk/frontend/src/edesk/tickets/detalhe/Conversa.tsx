import { useEffect, useRef, useState } from 'react'
import { useMe } from '@/api/queries/useMe'
import { ROTULO_STATUS } from '../format'
import type { StatusTicket } from '../tipos'
import { useAcoesTicket, useMacros } from './dados'
import type { Mensagem, TicketDetalhe } from './tiposDetalhe'

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

function haQuanto(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

const ICONE_CANAL: Record<string, string> = {
  web: 'ri-mail-line',
  chat: 'ri-chat-3-line',
  internal: 'ri-lock-line',
  system: 'ri-robot-2-line',
}
const ROTULO_CANAL: Record<string, string> = {
  web: 'Pelo e-mail',
  chat: 'Pelo chat',
  internal: 'Interno',
  system: 'Automático',
}

const STATUS_ENVIO: StatusTicket[] = ['open', 'pending_customer', 'new', 'closed']

function Bolha({ msg }: { msg: Mensagem }) {
  const interno = !msg.is_public
  return (
    <div className={'conversa__msg' + (msg.author_is_internal ? ' conversa__msg--agente' : '')}>
      <span
        className={
          'conversa__avatar' + (msg.author_is_internal ? ' conversa__avatar--agente' : '')
        }
      >
        {msg.author_avatar ? (
          <img src={msg.author_avatar} alt={msg.author_name} />
        ) : (
          iniciais(msg.author_name)
        )}
      </span>
      <div className="conversa__msg-corpo">
        <div className="conversa__msg-meta">
          <span className="conversa__msg-autor">{msg.author_name}</span>
          <i className={ICONE_CANAL[msg.source] ?? 'ri-mail-line'} />
          <span className="conversa__msg-sep">·</span>
          <span className="conversa__msg-tempo">{haQuanto(msg.created_at)}</span>
          {interno && <span className="conversa__msg-tag-interna">Nota interna</span>}
          {msg.edited_at && <span className="conversa__msg-editada">editada</span>}
        </div>
        <div
          className={
            'conversa__balao' +
            (msg.author_is_internal ? ' conversa__balao--agente' : '') +
            (interno ? ' conversa__balao--interna' : '') +
            (msg.is_deleted ? ' conversa__balao--apagada' : '')
          }
        >
          {msg.is_deleted ? <em>Mensagem apagada</em> : msg.body}
        </div>
        {msg.attachments.length > 0 && (
          <div className="conversa__anexos">
            {msg.attachments.map((a) => (
              <span key={a.id} className="conversa__anexo">
                <i className="ri-attachment-2" />
                {a.filename}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function Conversa({ ticket }: { ticket: TicketDetalhe }) {
  const { data: me } = useMe()
  const { data: macros } = useMacros()
  const { responder } = useAcoesTicket(ticket.id)

  const [texto, setTexto] = useState('')
  const [publico, setPublico] = useState(true)
  const [statusEnvio, setStatusEnvio] = useState<StatusTicket>('open')
  const [abrirStatus, setAbrirStatus] = useState(false)
  const [anexos, setAnexos] = useState<File[]>([])
  const inputAnexo = useRef<HTMLInputElement>(null)
  const fimMensagens = useRef<HTMLDivElement>(null)

  // rola para a última mensagem quando o total muda — inclui a mensagem que
  // chega por realtime (ws), que é o que torna o push visível sem F5.
  const totalMensagens = ticket.messages.length
  useEffect(() => {
    fimMensagens.current?.scrollIntoView({ block: 'end' })
  }, [totalMensagens])

  // pode enviar com texto OU só anexo (anexar um print sem comentário é válido)
  const podeEnviar = (texto.trim().length > 0 || anexos.length > 0) && !responder.isPending

  function enviar() {
    if (!podeEnviar) return
    responder.mutate(
      {
        body: texto.trim(),
        is_public: publico,
        // resposta pública de agente exige status; nota interna não manda status
        ...(publico && me?.is_internal ? { new_status: statusEnvio } : {}),
        ...(anexos.length > 0 ? { files: anexos } : {}),
      },
      {
        onSuccess: () => {
          setTexto('')
          setAnexos([])
        },
      },
    )
  }

  const badgeSla = ticket.sla?.first_response
  const estadoSla = badgeSla?.state
  const min = badgeSla?.minutes_left

  return (
    <section className="conversa">
      {/* Header */}
      <header className="conversa__header">
        <div className="conversa__titulo-bloco">
          <h1 className="conversa__titulo">
            {ticket.is_restricted && <i className="ri-lock-line" />}
            {ticket.subject}
          </h1>
          <div className="conversa__sub">
            {min != null && estadoSla && estadoSla !== 'none' && (
              <span className={'conversa__sla conversa__sla--' + estadoSla}>
                {min < 0 ? `-${Math.abs(min)}m` : `${min}m`}
              </span>
            )}
            <span className="conversa__canal">
              <i className={ICONE_CANAL[ticket.source] ?? 'ri-mail-line'} />
              {ROTULO_CANAL[ticket.source] ?? ticket.source}
            </span>
          </div>
        </div>
        <div className="conversa__acoes-header">
          <button type="button" aria-label="Resumo"><i className="ri-list-check" /></button>
          <button type="button" aria-label="Filtrar"><i className="ri-filter-3-line" /></button>
          <button type="button" aria-label="Histórico"><i className="ri-history-line" /></button>
          <button type="button" aria-label="Mais"><i className="ri-more-2-fill" /></button>
        </div>
      </header>

      {/* Mensagens */}
      <div className="conversa__mensagens">
        {ticket.messages.length === 0 ? (
          <p className="conversa__vazio">Nenhuma mensagem ainda.</p>
        ) : (
          ticket.messages.map((m) => <Bolha key={m.id} msg={m} />)
        )}
        <div ref={fimMensagens} />
      </div>

      {/* Compositor */}
      <div className="conversa__composer">
        <div className="conversa__composer-topo">
          <div className="conversa__tipo-resposta">
            <button
              type="button"
              className={'conversa__seg' + (publico ? ' conversa__seg--on' : '')}
              onClick={() => setPublico(true)}
            >
              <i className="ri-reply-line" /> Resposta pública
            </button>
            <button
              type="button"
              className={'conversa__seg' + (!publico ? ' conversa__seg--on' : '')}
              onClick={() => setPublico(false)}
            >
              <i className="ri-sticky-note-line" /> Nota interna
            </button>
          </div>
          <div className="conversa__para">
            Para <span className="conversa__para-chip">{ticket.requester_display}</span>
          </div>
        </div>

        <textarea
          className="conversa__textarea"
          placeholder={publico ? 'Escreva a resposta ao cliente…' : 'Nota interna (não vai para o cliente)…'}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />

        <div className="conversa__toolbar">
          <button type="button" aria-label="Anexar" onClick={() => inputAnexo.current?.click()}>
            <i className="ri-attachment-2" />
          </button>
          <input
            ref={inputAnexo}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              setAnexos((a) => [...a, ...Array.from(e.target.files ?? [])])
              e.target.value = '' // permite re-selecionar o mesmo arquivo
            }}
          />
          <button type="button" aria-label="Formatar"><i className="ri-text" /></button>
          <button type="button" aria-label="Emoji"><i className="ri-emotion-happy-line" /></button>
          <button type="button" aria-label="Link"><i className="ri-link" /></button>
        </div>

        {anexos.length > 0 && (
          <div className="conversa__anexos-pend">
            {anexos.map((f, i) => (
              <span key={`${f.name}-${i}`} className="conversa__anexo-chip">
                <i className="ri-attachment-2" />
                {f.name}
                <button
                  type="button"
                  aria-label={`Remover ${f.name}`}
                  onClick={() => setAnexos((a) => a.filter((_, j) => j !== i))}
                >
                  <i className="ri-close-line" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="conversa__composer-rodape">
          {/* Aplicar macro: preenche o texto pronto (macro.body) no compositor */}
          <div className="conversa__macro">
            <i className="ri-flashlight-line" />
            <select
              value=""
              onChange={(e) => {
                const m = macros?.find((x) => x.id === Number(e.target.value))
                if (m?.body) setTexto((t) => (t ? `${t}\n${m.body}` : m.body))
              }}
            >
              <option value="">Aplicar macro</option>
              {(macros ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="conversa__enviar-grupo">
            <button
              type="button"
              className="conversa__enviar"
              disabled={!podeEnviar}
              onClick={enviar}
            >
              {responder.isPending
                ? 'Enviando…'
                : publico && me?.is_internal
                  ? `Enviar como ${ROTULO_STATUS[statusEnvio]}`
                  : publico
                    ? 'Enviar'
                    : 'Salvar nota'}
            </button>
            {publico && me?.is_internal && (
              <div className="conversa__enviar-menu-wrap">
                <button
                  type="button"
                  className="conversa__enviar-toggle"
                  aria-label="Escolher status"
                  onClick={() => setAbrirStatus((v) => !v)}
                >
                  <i className="ri-arrow-down-s-line" />
                </button>
                {abrirStatus && (
                  <ul className="conversa__enviar-menu">
                    {STATUS_ENVIO.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          onClick={() => {
                            setStatusEnvio(s)
                            setAbrirStatus(false)
                          }}
                        >
                          Enviar como {ROTULO_STATUS[s]}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
