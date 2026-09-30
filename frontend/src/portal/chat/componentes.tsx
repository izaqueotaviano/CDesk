import {
  IconArrowBackUp,
  IconCheck,
  IconChecks,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypeDoc,
  IconFileTypePdf,
  IconFileZip,
  IconHeadset,
  IconLock,
  IconPaperclip,
  IconPhoto,
  IconPresentation,
} from '@tabler/icons-react'
import { urlApi } from '@/resolv/tickets/detalhe/linhaDoTempo'
import type { Chat, MensagemChat, StatusChat } from '@/api/chat'
import {
  destacar,
  ehImagemVisivel,
  estadoDaMensagem,
  iconeDoArquivo,
  motivoIndisponivel,
  ROTULO_DO_ESTADO,
} from '@/chat/conversa'
import { Avatar, PontoDePresenca, type Presenca } from '@/ui/Avatar'
import { abrirNoVisualizador, useVisualizadorImagem } from '@/ui/useVisualizadorImagem'
import { cn } from '../lib/cn'
import { hora, relativo, tamanhoArquivo } from '../lib/formato'
import { Badge } from '../ui/badge'

/** O ponto é `aria-hidden`; o rótulo por extenso é o que sobra para quem usa
 *  leitor de tela. */
const ROTULO_PRESENCA: Record<Presenca, string> = {
  available: 'disponível',
  away: 'ausente',
  offline: 'offline',
}

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
        // sem borda: `border-acento/30` não existe (cor por variável não aceita
        // opacidade no Tailwind) e o `border` sobrava com o cinza padrão —
        // um contorno claro no tema escuro. O selecionado é o véu, só.
        'flex w-full items-center gap-3 rounded-md p-3 text-left transition-colors hover:bg-[var(--fundo-hover)]',
        ativo && 'bg-acento-suave hover:bg-acento-suave',
      )}
    >
      <span className="relative shrink-0">
        <span className="grid size-10 place-items-center rounded-total bg-navegacao-ativo text-tinta-secundaria">
          <IconHeadset className="size-4" aria-hidden="true" />
        </span>
        {/* "o atendente ainda está aí?" decide entre esperar a resposta e
            voltar depois — some quando a conversa fecha, onde o estado de
            agora não diz nada sobre uma conversa que já terminou */}
        {chat.status === 'active' && chat.agent_presence && (
          <>
            <PontoDePresenca presenca={chat.agent_presence} tamanho="lg" />
            <span className="sr-only">{`${chat.agent_name ?? 'Atendente'}, ${ROTULO_PRESENCA[chat.agent_presence]}`}</span>
          </>
        )}
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

/** O ícone do tipo, no vocabulário de ícones do portal (Tabler React). */
function IconeDeArquivo({ tipo }: { tipo: string }) {
  const nome = iconeDoArquivo(tipo)
  const Icone =
    nome === 'ti-file-type-pdf'
      ? IconFileTypePdf
      : nome === 'ti-file-spreadsheet'
        ? IconFileSpreadsheet
        : nome === 'ti-file-type-doc'
          ? IconFileTypeDoc
          : nome === 'ti-presentation'
            ? IconPresentation
            : nome === 'ti-file-zip'
              ? IconFileZip
              : nome === 'ti-file-text'
                ? IconFileText
                : nome === 'ti-photo'
                  ? IconPhoto
                  : IconPaperclip
  return <Icone className="size-3" aria-hidden="true" />
}

export function Anexos({ msg }: { msg: Pick<MensagemChat, 'files'> }) {
  // Imagem abre o visualizador compartilhado (← → entre as desta mensagem);
  // Ctrl/⌘+clique continua abrindo o arquivo numa aba nova.
  const imagens = (msg.files ?? []).filter(ehImagemVisivel)
  const visualizador = useVisualizadorImagem(
    imagens.map((f) => ({ url: urlApi(f.url), nome: f.filename, detalhe: tamanhoArquivo(f.size_bytes) })),
  )
  if (!msg.files?.length) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Anexos">
      {msg.files.map((f) =>
        // Miniatura só depois que a varredura LIBEROU — antes disso o arquivo
        // está em quarentena e renderizá-lo seria servi-lo assim mesmo (D19).
        ehImagemVisivel(f) ? (
          <li key={f.id}>
            <a
              href={urlApi(f.url)}
              target="_blank"
              rel="noreferrer"
              title={`${f.filename} · ${tamanhoArquivo(f.size_bytes)}`}
              className="block overflow-hidden rounded-md  hover:border-acento"
              onClick={(e) => abrirNoVisualizador(e, () => visualizador.abrir(imagens.indexOf(f)))}
            >
              <img
                src={urlApi(f.url)}
                alt={f.filename}
                loading="lazy"
                className="max-h-40 max-w-[220px] object-cover"
              />
            </a>
          </li>
        ) : f.is_downloadable ? (
          <li key={f.id}>
            <a
              href={urlApi(f.url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-6 items-center gap-1.5 rounded-md  bg-superficie px-2 py-0.5 text-legenda text-acento hover:border-acento hover:bg-acento-suave"
            >
              {/* ícone pelo TIPO detectado no servidor, não pela extensão */}
              <IconeDeArquivo tipo={f.content_type} />
              {f.filename}
              <span className="text-tinta-terciaria">{tamanhoArquivo(f.size_bytes)}</span>
            </a>
          </li>
        ) : (
          <li
            key={f.id}
            className="inline-flex min-h-6 items-center gap-1.5 rounded-md  bg-navegacao px-2 py-0.5 text-legenda text-tinta-secundaria"
          >
            <IconLock className="size-3" aria-hidden="true" />
            {/* o motivo por extenso: cada caso pede uma ação diferente, e "bloqueado" sozinho não diz qual */}
            {f.filename} · {motivoIndisponivel(f)}
          </li>
        ),
      )}
      {visualizador.elemento}
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
  termo = '',
  emFoco = false,
  onResponder,
  onIrPara,
}: {
  msg: Pick<
    MensagemChat,
    | 'id'
    | 'body'
    | 'sent_at'
    | 'author_name'
    | 'author_is_internal'
    | 'edited_at'
    | 'is_deleted'
    | 'files'
    | 'read_at'
    | 'delivered_at'
    | 'reply_preview'
  >
  acoes?: React.ReactNode
  /** Termo da busca: os trechos que casam saem em <mark>. */
  termo?: string
  /** É o resultado da busca em que a navegação está agora. */
  emFoco?: boolean
  onResponder?: () => void
  onIrPara?: (id: number) => void
}) {
  const doSuporte = msg.author_is_internal
  // O indicador de estado é de quem ESCREVEU — no portal, das minhas.
  const estado = estadoDaMensagem(msg)
  return (
    <article
      data-msg={msg.id}
      className={cn(
        'group flex gap-2.5 rounded-md px-3.5 py-3',
        // suporte em branco, o meu em azul suave — como qualquer mensageiro
        doSuporte ? 'bg-superficie' : 'bg-acento-suave',
        emFoco && 'ring-2 ring-acento',
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
          <span className="ml-auto flex items-center gap-0.5">
            {onResponder && !msg.is_deleted && (
              <button
                type="button"
                aria-label={`Responder à mensagem de ${msg.author_name}`}
                title="Responder"
                onClick={onResponder}
                className="rounded p-1 text-tinta-secundaria opacity-0 hover:text-acento focus-visible:opacity-100 group-hover:opacity-100"
              >
                <IconArrowBackUp className="size-3.5" aria-hidden="true" />
              </button>
            )}
            {acoes}
          </span>
        </header>
        {msg.reply_preview && onIrPara && (
          <button
            type="button"
            onClick={() => onIrPara(msg.reply_preview!.id)}
            className="mt-1 flex w-full flex-col items-start gap-0.5 rounded-md border-l-2 border-acento bg-navegacao px-2 py-1 text-left hover:bg-acento-suave"
          >
            <span className="text-legenda font-medio text-acento">{msg.reply_preview.author_name}</span>
            <span className="w-full truncate text-legenda text-tinta-secundaria">
              {msg.reply_preview.is_deleted
                ? 'Mensagem apagada'
                : msg.reply_preview.excerpt || (msg.reply_preview.has_files ? 'Anexo' : '')}
            </span>
          </button>
        )}
        <p
          className={cn(
            'mt-1 whitespace-pre-wrap text-[13px] leading-normal text-tinta [overflow-wrap:anywhere]',
            msg.is_deleted && 'italic text-tinta-terciaria',
          )}
        >
          {msg.is_deleted ? (
            'Mensagem apagada'
          ) : termo.trim() ? (
            destacar(msg.body, termo).map((p, i) =>
              p.destacado ? (
                <mark key={i} className="rounded-[2px] bg-alerta-suave text-tinta">
                  {p.texto}
                </mark>
              ) : (
                <span key={i}>{p.texto}</span>
              ),
            )
          ) : (
            msg.body
          )}
        </p>
        {!msg.is_deleted && <Anexos msg={msg} />}
        {!doSuporte && !msg.is_deleted && (
          <span
            className={cn(
              'mt-1 flex items-center gap-1 text-legenda text-tinta-terciaria',
              estado === 'lida' && 'text-acento',
            )}
          >
            {estado === 'lida' || estado === 'entregue' ? (
              <IconChecks className="size-3" aria-hidden="true" />
            ) : (
              <IconCheck className="size-3" aria-hidden="true" />
            )}
            {/* rótulo por extenso, não só ícone e cor (item 22) */}
            {ROTULO_DO_ESTADO[estado]}
          </span>
        )}
      </div>
    </article>
  )
}
