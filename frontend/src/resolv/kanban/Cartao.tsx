import { useDraggable } from '@dnd-kit/core'
import { useState, type CSSProperties, type SyntheticEvent } from 'react'
import { API_BASE_URL } from '@/api/client'
import { identidadeDe } from '@/ui/identidade'
import { ROTULO_PRIORIDADE } from '../tickets/format'
import { tempoSla } from '../tickets/detalhe/linhaDoTempo'
import {
  MARCADOR_PRIORIDADE,
  coresDaBarra,
  descreverPrazo,
  descreverSla,
  paraDatetimeLocal,
  rotuloDoCartao,
  slaDoCartao,
  type StatusDoCartao,
} from './formato'
import type { Cartao as CartaoTipo } from './tipos'

/** `avatar_url` chega como caminho relativo (`/avatars/...`) — sem a base da
 *  API na frente, o navegador resolveria contra a origem do Vite e o
 *  avatar 404ava (visto ao vivo, testando esta tela). */
function urlAvatar(caminho: string): string {
  return caminho.startsWith('http') ? caminho : `${API_BASE_URL}${caminho}`
}

/** Controles DENTRO do cartão (prazo) não podem virar início de arraste nem
 *  abrir o chamado: o cartão inteiro é a alça do drag e o alvo do clique. */
const naoPropagar = (e: SyntheticEvent) => e.stopPropagation()
const ISOLAR = {
  onPointerDown: naoPropagar,
  onMouseDown: naoPropagar,
  onTouchStart: naoPropagar,
  onClick: naoPropagar,
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

interface PrazoProps {
  cartao: CartaoTipo
  agoraMs: number
  editavel: boolean
  onDefinirPrazo: (ticketId: number, iso: string | null) => void
}

/**
 * Prazo INTERNO do quadro — nunca o mesmo selo do SLA contratual: são dois
 * relógios diferentes. Só aparece quando existe; sem prazo, o cartão mostra
 * um "Definir prazo" discreto que só surge no hover/foco (e, no toque, só o
 * ícone). Antes todo cartão tinha um "Prazo" com ampulheta, com ou sem
 * data, e aquilo lia como um botão de ação primária repetido na tela toda.
 */
function Prazo({ cartao, agoraMs, editavel, onDefinirPrazo }: PrazoProps) {
  const [editando, setEditando] = useState(false)
  const prazo = cartao.due_at ? descreverPrazo(cartao.due_at, new Date(agoraMs), cartao.is_overdue) : null

  if (!editavel) {
    return prazo ? (
      <span className={`kb-cartao__prazo kb-cartao__prazo--${prazo.tom}`}>
        <i className="ti ti-calendar-due" aria-hidden="true" />
        {prazo.rotulo}
      </span>
    ) : null
  }

  if (editando) {
    const original = cartao.due_at ? paraDatetimeLocal(cartao.due_at) : ''
    return (
      <span className="kb-cartao__prazo-edicao" {...ISOLAR} onKeyDown={naoPropagar}>
        <input
          type="datetime-local"
          className="kb-cartao__prazo-input"
          aria-label={`Prazo interno de ${cartao.ticket_reference}`}
          autoFocus
          defaultValue={original}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditando(false)
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onBlur={(e) => {
            const valor = e.target.value
            setEditando(false)
            // só grava o que mudou: sair do campo sem mexer não é um PATCH
            if (valor !== original) onDefinirPrazo(cartao.ticket, valor ? new Date(valor).toISOString() : null)
          }}
        />
        {cartao.due_at && (
          <button
            type="button"
            className="kb-cartao__prazo-remover"
            aria-label="Remover prazo"
            title="Remover prazo"
            // mousedown sem default: o campo não perde o foco (e não grava)
            // antes do clique chegar aqui
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setEditando(false)
              onDefinirPrazo(cartao.ticket, null)
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        )}
      </span>
    )
  }

  if (prazo) {
    return (
      <button
        type="button"
        className={`kb-cartao__prazo kb-cartao__prazo--${prazo.tom}`}
        title={`${prazo.descricao}. Clique para alterar.`}
        aria-label={`${prazo.descricao}. Alterar prazo`}
        {...ISOLAR}
        onClick={(e) => {
          e.stopPropagation()
          setEditando(true)
        }}
      >
        <i className="ti ti-calendar-due" aria-hidden="true" />
        {prazo.rotulo}
      </button>
    )
  }

  return (
    <button
      type="button"
      className="kb-cartao__prazo kb-cartao__prazo--definir"
      title="Definir prazo interno"
      aria-label={`Definir prazo interno de ${cartao.ticket_reference}`}
      {...ISOLAR}
      onClick={(e) => {
        e.stopPropagation()
        setEditando(true)
      }}
    >
      <i className="ti ti-calendar-due" aria-hidden="true" />
      <span className="kb-cartao__prazo-texto">Definir prazo</span>
    </button>
  )
}

interface ConteudoProps {
  cartao: CartaoTipo
  /** Nome e cor do status DE VERDADE do ticket (a faixa do cartão vem daqui). */
  status: StatusDoCartao
  /** Numa coluna de organização a coluna não diz o status: o cartão diz. */
  mostrarStatus?: boolean
  agoraMs: number
  /** Falso na cópia que segue o ponteiro (DragOverlay): nada clicável nela. */
  editavel?: boolean
  onDefinirPrazo?: (ticketId: number, iso: string | null) => void
}

/** O desenho do cartão, sem o comportamento de arraste — usado pelo cartão
 *  na coluna e pela cópia no DragOverlay (que não pode registrar um segundo
 *  `useDraggable` com o mesmo id). */
export function ConteudoDoCartao({
  cartao,
  status,
  mostrarStatus = false,
  agoraMs,
  editavel = false,
  onDefinirPrazo = () => {},
}: ConteudoProps) {
  const [avatarFalhou, setAvatarFalhou] = useState(false)
  const { relogio, qual } = slaDoCartao(cartao)
  // "cumprido" não pede nada de quem olha o quadro: só o relógio que ainda
  // corre (ou já estourou) ganha selo
  const mostrarSla = relogio.state !== 'none' && relogio.state !== 'met' && relogio.minutes_left != null
  const marcador = MARCADOR_PRIORIDADE[cartao.priority]
  const cliente = [cartao.company_name, cartao.requester_display].filter(Boolean).join(' » ')
  const selo = coresDaBarra(status.cor)

  return (
    <>
      <div className="kb-cartao__topo">
        <span className="kb-cartao__ref">{cartao.ticket_reference}</span>
        {mostrarStatus && (
          <span className="kb-cartao__status" style={{ background: selo.fundo, color: selo.texto }}>
            {status.nome}
          </span>
        )}
        {marcador && (
          <span className={`kb-cartao__prioridade kb-cartao__prioridade--${cartao.priority}`}>
            <i className={marcador} aria-hidden="true" />
            {ROTULO_PRIORIDADE[cartao.priority]}
          </span>
        )}
      </div>

      <p className="kb-cartao__assunto" title={cartao.subject}>
        {cartao.subject}
      </p>

      {cliente && (
        <p className="kb-cartao__cliente" title={cliente}>
          {cartao.company_name && <span className="kb-cartao__empresa">{cartao.company_name}</span>}
          {cartao.company_name && cartao.requester_display && (
            <i className="ti ti-chevrons-right" aria-hidden="true" />
          )}
          {cartao.requester_display && <span className="kb-cartao__contato">{cartao.requester_display}</span>}
        </p>
      )}

      <div className="kb-cartao__rodape">
        <div className="kb-cartao__sinais">
          <Prazo cartao={cartao} agoraMs={agoraMs} editavel={editavel} onDefinirPrazo={onDefinirPrazo} />
          {mostrarSla && (
            // `tempoSla` e não minuto cru: um SLA estourado há três semanas
            // virava "-29845m". O número sozinho não diz qual relógio é nem
            // se o negativo é "passou" — a frase inteira vai no tooltip.
            <span
              className={`kb-cartao__sla kb-cartao__sla--${relogio.state}`}
              title={descreverSla(relogio, qual)}
            >
              <i className="ti ti-alarm" aria-hidden="true" />
              {tempoSla(relogio)}
            </span>
          )}
        </div>

        <div className="kb-cartao__fim">
          {cartao.message_count > 0 && (
            <span className="kb-cartao__contador" title={plural(cartao.message_count, 'mensagem', 'mensagens')}>
              <i className="ti ti-message-circle-2" aria-hidden="true" />
              {cartao.message_count}
            </span>
          )}
          {cartao.attachment_count > 0 && (
            <span className="kb-cartao__contador" title={plural(cartao.attachment_count, 'anexo', 'anexos')}>
              <i className="ti ti-paperclip" aria-hidden="true" />
              {cartao.attachment_count}
            </span>
          )}
          {cartao.assignee_name && (
            <span className="kb-cartao__responsavel" title={`Responsável: ${cartao.assignee_name}`}>
              {cartao.assignee_avatar && !avatarFalhou ? (
                <img
                  src={urlAvatar(cartao.assignee_avatar)}
                  alt=""
                  // Visto ao vivo: o servidor de estático em dev não manda CORS
                  // pro avatar, e o navegador bloqueia a resposta cross-origin
                  // (ORB) — cai pra inicial em vez de deixar o ícone quebrado.
                  onError={() => setAvatarFalhou(true)}
                />
              ) : (
                <span className="kb-cartao__avatar-fallback" {...identidadeDe(cartao.assignee_name)}>
                  {cartao.assignee_name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="kb-cartao__responsavel-nome">{cartao.assignee_name}</span>
            </span>
          )}
        </div>
      </div>
    </>
  )
}

interface Props {
  cartao: CartaoTipo
  status: StatusDoCartao
  mostrarStatus?: boolean
  agoraMs: number
  onAbrir: (ticketId: number) => void
  onDefinirPrazo: (ticketId: number, iso: string | null) => void
}

export function Cartao({ cartao, status, mostrarStatus, agoraMs, onAbrir, onDefinirPrazo }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `ticket-${cartao.ticket}`,
    data: { ticketId: cartao.ticket },
  })

  // Sem `transform` aqui de propósito: quem segue o ponteiro é a cópia no
  // DragOverlay. O original fica no lugar como um encaixe vazio, mostrando
  // de onde o cartão saiu.
  return (
    <div
      ref={setNodeRef}
      data-ticket={cartao.ticket}
      className={'kb-cartao' + (isDragging ? ' kb-cartao--origem' : '')}
      style={{ '--kb-cor': status.cor } as CSSProperties}
      {...attributes}
      {...listeners}
      aria-label={rotuloDoCartao(cartao, agoraMs)}
      onClick={() => {
        if (!isDragging) onAbrir(cartao.ticket)
      }}
      onKeyDown={(e) => {
        // Enter abre o chamado; o resto (espaço pega/solta, setas movem) é do
        // sensor de teclado do dnd-kit. Antes este handler SUBSTITUÍA o dos
        // listeners (vinha depois no spread) e o arraste por teclado nunca
        // começava, apesar de as instruções dizerem que sim.
        if (e.key === 'Enter' && e.target === e.currentTarget && !isDragging) {
          e.preventDefault()
          onAbrir(cartao.ticket)
          return
        }
        listeners?.onKeyDown?.(e)
      }}
    >
      <ConteudoDoCartao
        cartao={cartao}
        status={status}
        mostrarStatus={mostrarStatus}
        agoraMs={agoraMs}
        editavel
        onDefinirPrazo={onDefinirPrazo}
      />
    </div>
  )
}
