import { Headset, Lock, Paperclip } from 'lucide-react'
import { urlApi } from '@/resolv/tickets/detalhe/linhaDoTempo'
import type { Chat, MensagemChat, StatusChat } from '@/api/chat'
import { Avatar } from '@/ui/Avatar'
import { cn } from '../lib/cn'
import { hora, relativo, tamanhoArquivo } from '../lib/formato'
import { Badge } from '../ui/badge'

export const ROTULO_CHAT: Record<StatusChat, { rotulo: string; tom: 'acento' | 'ok' | 'neutro' }> = {
  queued: { rotulo: 'Na fila', tom: 'acento' },
  active: { rotulo: 'Em atendimento', tom: 'ok' },
  closed: { rotulo: 'Encerrada', tom: 'neutro' },
}

export function PilulaChat({ chat }: { chat: Pick<Chat, 'status' | 'rating_pending'> }) {
  if (chat.rating_pending) {
    return (
      <Badge variant="alerta" ponto>
        Avaliação pendente
      </Badge>
    )
  }
  const s = ROTULO_CHAT[chat.status]
  return (
    <Badge variant={s.tom} ponto>
      {s.rotulo}
    </Badge>
  )
}

/** Um item da lista — conversa viva ou do histórico. */
export function CartaoConversa({
  chat,
  agoraMs,
  ativo,
  onClick,
}: {
  chat: Chat
  agoraMs: number
  ativo: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativo || undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border border-transparent p-3 text-left transition-colors hover:bg-navegacao focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40',
        ativo && 'border-acento/30 bg-acento-suave hover:bg-acento-suave',
      )}
    >
      <span className="relative shrink-0">
        <span className="grid size-10 place-items-center rounded-total bg-navegacao text-tinta-secundaria">
          <Headset className="size-4" aria-hidden="true" />
        </span>
        {chat.unread_count > 0 && (
          <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-total bg-perigo text-[10px] font-forte text-white">
            {chat.unread_count > 9 ? '9+' : chat.unread_count}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-pequeno font-medio text-tinta">
            {chat.agent_name ? chat.agent_name : chat.status === 'queued' ? 'Aguardando atendente' : 'Suporte'}
          </span>
          <span className="shrink-0 text-legenda text-tinta-terciaria">{relativo(chat.closed_at ?? chat.accepted_at ?? chat.queued_at, agoraMs)}</span>
        </span>
        <span className="block truncate text-legenda text-tinta-secundaria">{chat.last_message_preview ?? 'Sem mensagens ainda'}</span>
        <span className="mt-1 inline-block">
          <PilulaChat chat={chat} />
        </span>
      </span>
    </button>
  )
}

function Anexos({ msg }: { msg: MensagemChat }) {
  if (!msg.files?.length) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Anexos">
      {msg.files.map((f) =>
        f.is_downloadable ? (
          <li key={f.id}>
            <a
              href={urlApi(f.url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-divisoria bg-superficie px-2.5 py-1 text-legenda text-acento hover:border-acento hover:bg-acento-suave"
            >
              <Paperclip className="size-3" aria-hidden="true" />
              {f.filename}
              <span className="text-tinta-terciaria">{tamanhoArquivo(f.size_bytes)}</span>
            </a>
          </li>
        ) : (
          <li
            key={f.id}
            className="inline-flex items-center gap-1.5 rounded-lg border border-divisoria bg-navegacao px-2.5 py-1 text-legenda text-tinta-secundaria"
            title="Em verificação de segurança"
          >
            <Lock className="size-3" aria-hidden="true" />
            {f.filename} · em verificação
          </li>
        ),
      )}
    </ul>
  )
}

/** Bolha de mensagem — do cliente (à direita, acento) ou do agente/sistema. */
export function Bolha({
  msg,
  onEditar,
  onExcluir,
}: {
  msg: MensagemChat
  onEditar: (m: MensagemChat) => void
  onExcluir: (m: MensagemChat) => void
}) {
  if (msg.is_system) {
    return (
      <p className="self-center rounded-total bg-navegacao px-3 py-1 text-legenda italic text-tinta-secundaria">
        {msg.body} · {hora(msg.sent_at)}
      </p>
    )
  }
  const minhaMensagem = !msg.author_is_internal
  return (
    <article
      className={cn('flex max-w-[85%] flex-col gap-1', minhaMensagem ? 'self-end items-end' : 'self-start items-start')}
      aria-label={`Mensagem de ${msg.author_name}`}
    >
      <div className="flex items-center gap-2 text-legenda text-tinta-secundaria">
        {!minhaMensagem && (
          <Avatar nome={msg.author_name} tamanho="sm" />
        )}
        <span className="font-medio text-tinta">{minhaMensagem ? 'Você' : msg.author_name}</span>
        <time dateTime={msg.sent_at}>{hora(msg.sent_at)}</time>
        {msg.edited_at && <span className="italic">editada</span>}
      </div>
      <div
        className={cn(
          'rounded-xl px-3.5 py-2.5 text-corpo leading-normal shadow-elevacao-1',
          minhaMensagem ? 'rounded-tr-sm bg-acento text-acento-sobre' : 'rounded-tl-sm border border-divisoria bg-superficie text-tinta',
          msg.is_deleted && 'italic opacity-70',
        )}
      >
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{msg.is_deleted ? 'Mensagem apagada' : msg.body}</p>
        {!msg.is_deleted && <Anexos msg={msg} />}
      </div>
      {msg.can_edit && !msg.is_deleted && (
        <div className="flex gap-1">
          <button type="button" onClick={() => onEditar(msg)} className="rounded-md px-1.5 py-0.5 text-legenda text-tinta-secundaria hover:bg-navegacao hover:text-tinta">
            Editar
          </button>
          <button type="button" onClick={() => onExcluir(msg)} className="rounded-md px-1.5 py-0.5 text-legenda text-tinta-secundaria hover:bg-perigo-suave hover:text-perigo">
            Excluir
          </button>
        </div>
      )}
    </article>
  )
}
