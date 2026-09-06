import { useState, type FormEvent } from 'react'
import { ArrowLeft, Download, History, Lock, Paperclip, Search } from 'lucide-react'
import type { MensagemChat } from '@/api/chat'
import { Avatar } from '@/ui/Avatar'
import { urlApi } from '@/resolv/tickets/detalhe/linhaDoTempo'
import {
  urlExportarConversaContinua,
  useConversaContinua,
  type MensagemLinhaDoTempo,
  type SessaoLinhaDoTempo,
} from '../api/chats'
import { cn } from '../lib/cn'
import { dataHora, hora, tamanhoArquivo } from '../lib/formato'
import { Button, buttonVariants } from '../ui/button'
import { EstadoVazio } from '../ui/estado-vazio'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'

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

/** Bolha somente leitura — de propósito sem editar/excluir: são atendimentos
 *  já costurados de outras sessões, e misturar isso ao editor de UMA sessão
 *  (`Conversa.tsx`) exigiria carregar o `chat_id` certo por mensagem. */
function BolhaLeitura({ msg }: { msg: MensagemLinhaDoTempo }) {
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
        {!minhaMensagem && <Avatar nome={msg.author_name} tamanho="sm" />}
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
    </article>
  )
}

/** Marcador entre um atendimento e outro — quem atendeu, quando começou e
 *  terminou, e a nota se já avaliado. Sem isso a conversa costurada viraria
 *  um bloco só, e a pessoa perderia a noção de que houve mais de um atendimento. */
function MarcadorSessao({ sessao }: { sessao: SessaoLinhaDoTempo }) {
  return (
    <div className="flex items-center gap-3 py-1 text-legenda text-tinta-secundaria before:h-px before:flex-1 before:bg-divisoria after:h-px after:flex-1 after:bg-divisoria">
      <span className="shrink-0 text-center">
        {sessao.agent_name ? `Atendimento com ${sessao.agent_name}` : 'Aguardando atendimento'} · {dataHora(sessao.queued_at)}
        {sessao.closed_at ? ` — ${dataHora(sessao.closed_at)}` : ' · em andamento'}
        {sessao.rating && (
          <> · nota {sessao.rating.service_score} (atendimento), {sessao.rating.resolution_score} (resolução)</>
        )}
      </span>
    </div>
  )
}

/**
 * A conversa contínua do cliente: todas as sessões de chat costuradas numa
 * linha só (`GET /api/v1/chat/timeline/`, apps/chat/views.py::ChatTimelineView)
 * — o mesmo dado que "Histórico" já mostra em cartões separados, aqui como
 * uma única thread, na ordem em que aconteceu. Backend já existia pronto e
 * testado; nenhuma tela consumia.
 */
export function ConversaContinua({ onVoltar }: { onVoltar?: () => void }) {
  const [cursores, setCursores] = useState<(number | undefined)[]>([undefined])
  const [busca, setBusca] = useState('')
  const [buscaAtiva, setBuscaAtiva] = useState('')
  const { mensagens, sessoes, carregando, erro, temMais } = useConversaContinua(cursores, buscaAtiva)

  const sessaoPorId = new Map(sessoes.map((s) => [s.id, s]))

  function carregarMais() {
    const maisAntiga = mensagens[0]?.id
    if (maisAntiga) setCursores((c) => [...c, maisAntiga])
  }

  function buscar(e: FormEvent) {
    e.preventDefault()
    setCursores([undefined])
    setBuscaAtiva(busca.trim())
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-divisoria p-4">
        {onVoltar && (
          <Button variant="ghost" size="icon-sm" onClick={onVoltar} aria-label="Voltar para a lista" className="md:hidden">
            <ArrowLeft />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <History className="size-4 shrink-0 text-tinta-secundaria" aria-hidden="true" />
          <p className="truncate text-corpo font-medio text-tinta">Conversa completa</p>
        </div>
        <a href={urlExportarConversaContinua()} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <Download /> PDF
        </a>
      </header>

      <form onSubmit={buscar} className="flex gap-2 border-b border-divisoria p-3">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar nas mensagens…"
          aria-label="Buscar nas mensagens"
          className="flex-1"
        />
        <Button type="submit" variant="outline" size="sm">
          <Search /> Buscar
        </Button>
      </form>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {temMais && (
          <Button variant="ghost" size="sm" className="mx-auto" disabled={carregando} onClick={carregarMais}>
            {carregando ? 'Carregando…' : 'Carregar conversas anteriores'}
          </Button>
        )}

        {erro ? (
          <p role="alert" className="m-auto text-pequeno text-perigo">
            Não foi possível carregar a conversa completa.
          </p>
        ) : carregando && mensagens.length === 0 ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando conversa completa">
            <Skeleton className="h-16 w-2/3" />
            <Skeleton className="ml-auto h-16 w-1/2" />
          </div>
        ) : mensagens.length === 0 ? (
          <EstadoVazio className="m-auto" icone={History} titulo="Nada por aqui ainda" descricao="Suas conversas com o suporte aparecem aqui." />
        ) : (
          (() => {
            let chatAnterior: number | null = null
            return mensagens.map((m) => {
              const novaSessao = m.chat_id !== chatAnterior
              chatAnterior = m.chat_id
              const sessao = sessaoPorId.get(m.chat_id)
              return (
                <div key={m.id} className="contents">
                  {novaSessao && sessao && <MarcadorSessao sessao={sessao} />}
                  <BolhaLeitura msg={m} />
                </div>
              )
            })
          })()
        )}
      </div>
    </div>
  )
}
