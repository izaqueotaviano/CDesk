import { IconHeadset, IconLock, IconPaperclip } from '@tabler/icons-react'
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
        'flex w-full items-center gap-3 rounded-md border border-transparent p-3 text-left transition-colors hover:bg-navegacao',
        ativo && 'border-acento/30 bg-acento-suave hover:bg-acento-suave',
      )}
    >
      <span className="relative shrink-0">
        <span className="grid size-10 place-items-center rounded-total bg-navegacao text-tinta-secundaria">
          <IconHeadset className="size-4" aria-hidden="true" />
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

export function Anexos({ msg }: { msg: Pick<MensagemChat, 'files'> }) {
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
              className="inline-flex min-h-6 items-center gap-1.5 rounded-md border border-divisoria bg-superficie px-2 py-0.5 text-legenda text-acento hover:border-acento hover:bg-acento-suave"
            >
              <IconPaperclip className="size-3" aria-hidden="true" />
              {f.filename}
              <span className="text-tinta-terciaria">{tamanhoArquivo(f.size_bytes)}</span>
            </a>
          </li>
        ) : (
          <li
            key={f.id}
            className="inline-flex min-h-6 items-center gap-1.5 rounded-md border border-divisoria bg-navegacao px-2 py-0.5 text-legenda text-tinta-secundaria"
            title="Em verificação de segurança"
          >
            <IconLock className="size-3" aria-hidden="true" />
            {f.filename} · em verificação
          </li>
        ),
      )}
    </ul>
  )
}

/** Mensagem do sistema ("Fulano entrou na conversa") — evento, não fala. */
export function MensagemDoSistema({ msg }: { msg: Pick<MensagemChat, 'body' | 'sent_at'> }) {
  return (
    <p role="status" className="self-center rounded-md bg-navegacao px-3 py-1 text-legenda italic text-tinta-secundaria">
      {msg.body} · {hora(msg.sent_at)}
    </p>
  )
}

/**
 * Uma mensagem da conversa — a mesma leitura do `.cc-msg` do console: lista
 * PLANA, avatar sempre à esquerda, sem balão nem rabicho, quem escreveu dito
 * pelo nome, pelo selo "Suporte" e pela barra de 2px na cor de ação, não
 * por lado da tela nem por cor de fundo. A conversa é um documento, não um
 * app de mensageria. `cabecalhoExtra` e `acoes` deixam a mesma peça servir
 * à sessão viva (com editar/excluir) e à conversa costurada (só leitura).
 */
export function Mensagem({
  msg,
  acoes,
}: {
  msg: Pick<MensagemChat, 'body' | 'sent_at' | 'author_name' | 'author_is_internal' | 'edited_at' | 'is_deleted' | 'files'>
  acoes?: React.ReactNode
}) {
  const doSuporte = msg.author_is_internal
  return (
    <article
      className={cn(
        'flex gap-2.5 rounded-md border border-divisoria bg-superficie px-3.5 py-3',
        doSuporte && 'border-l-2 border-l-acento',
      )}
      aria-label={`Mensagem de ${msg.author_name}`}
    >
      <Avatar nome={msg.author_name} tamanho="sm" />
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-legenda text-tinta-secundaria">
          <span className="text-[13px] font-medio text-tinta">{doSuporte ? msg.author_name : 'Você'}</span>
          {doSuporte && <Badge variant="acento">Suporte</Badge>}
          <time dateTime={msg.sent_at}>{hora(msg.sent_at)}</time>
          {msg.edited_at && <span className="italic">editada</span>}
          {acoes && <span className="ml-auto flex items-center gap-0.5">{acoes}</span>}
        </header>
        <p
          className={cn(
            'mt-1 whitespace-pre-wrap text-[13px] leading-normal text-tinta [overflow-wrap:anywhere]',
            msg.is_deleted && 'italic text-tinta-terciaria',
          )}
        >
          {msg.is_deleted ? 'Mensagem apagada' : msg.body}
        </p>
        {!msg.is_deleted && <Anexos msg={msg} />}
      </div>
    </article>
  )
}
