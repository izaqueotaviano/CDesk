import { useState, type FormEvent } from 'react'
import { IconArrowLeft, IconDownload, IconHistory, IconSearch } from '@tabler/icons-react'
import {
  urlExportarConversaContinua,
  useConversaContinua,
  type SessaoLinhaDoTempo,
} from '../api/chats'
import { dataHora } from '../lib/formato'
import { Button, buttonVariants } from '../ui/button'
import { ErroEstado, EstadoVazio } from '../ui/estado-vazio'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Mensagem, MensagemDoSistema } from './componentes'

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
 * uma única thread, na ordem em que aconteceu. Só leitura, de propósito: são
 * atendimentos de outras sessões, e misturar isso ao editor de UMA sessão
 * (`Conversa.tsx`) exigiria carregar o `chat_id` certo por mensagem.
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
            <IconArrowLeft />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IconHistory className="size-4 shrink-0 text-tinta-secundaria" aria-hidden="true" />
          <p className="truncate text-corpo font-medio text-tinta">Conversa completa</p>
        </div>
        <a href={urlExportarConversaContinua()} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <IconDownload /> PDF
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
        <Button type="submit" variant="outline">
          <IconSearch /> Buscar
        </Button>
      </form>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {temMais && (
          <Button variant="ghost" size="sm" className="mx-auto" disabled={carregando} onClick={carregarMais}>
            {carregando ? 'Carregando…' : 'Carregar conversas anteriores'}
          </Button>
        )}

        {erro ? (
          <ErroEstado className="m-auto" titulo="Não foi possível carregar a conversa completa" />
        ) : carregando && mensagens.length === 0 ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando conversa completa">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : mensagens.length === 0 ? (
          <EstadoVazio className="m-auto" icone={IconHistory} titulo="Nada por aqui ainda" descricao="Suas conversas com o suporte aparecem aqui." />
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
                  {m.is_system ? <MensagemDoSistema msg={m} /> : <Mensagem msg={m} />}
                </div>
              )
            })
          })()
        )}
      </div>
    </div>
  )
}
