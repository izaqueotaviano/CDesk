import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertCircle, Clock, MessageCircle, MessageSquarePlus } from 'lucide-react'
import {
  pendentesDoErro,
  useAbrirChat,
  useConfigChat,
  useMeuChatVivo,
  usePendingRatings,
  type Chat,
} from '@/api/chat'
import { ApiError } from '@/api/client'
import { useHistoricoChats } from '../api/chats'
import { dataHora, useAgora } from '../lib/formato'
import { Alert } from '../ui/alert'
import { Button, buttonVariants } from '../ui/button'
import { EstadoVazio } from '../ui/estado-vazio'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { CartaoConversa } from './componentes'
import { Conversa } from './Conversa'
import { ModalAvaliacao } from './ModalAvaliacao'

function Lista({
  vivo,
  historico,
  carregandoHistorico,
  selecionado,
  agoraMs,
  onSelecionar,
  onIniciar,
  iniciando,
  travado,
  motivoTravado,
}: {
  vivo: Chat | null | undefined
  historico: Chat[] | undefined
  carregandoHistorico: boolean
  selecionado: number | null
  agoraMs: number
  onSelecionar: (id: number) => void
  onIniciar: () => void
  iniciando: boolean
  travado: boolean
  motivoTravado?: string
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-divisoria p-4">
        <h1 className="text-titulo-sm font-forte">Chat</h1>
        <Button size="sm" disabled={travado || iniciando} onClick={onIniciar} title={travado ? motivoTravado : undefined}>
          <MessageSquarePlus /> {iniciando ? 'Abrindo…' : vivo ? 'Continuar' : 'Novo chat'}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {vivo && (
          <div className="mb-2">
            <p className="px-2 py-1 text-legenda font-medio uppercase tracking-rotulo text-tinta-secundaria">Conversa atual</p>
            <CartaoConversa chat={vivo} agoraMs={agoraMs} ativo={selecionado === vivo.id} onClick={() => onSelecionar(vivo.id)} />
          </div>
        )}

        <p className="px-2 py-1 text-legenda font-medio uppercase tracking-rotulo text-tinta-secundaria">Histórico</p>
        {carregandoHistorico ? (
          <div className="space-y-2 p-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : historico && historico.length > 0 ? (
          <div className="flex flex-col">
            {historico.map((c) => (
              <CartaoConversa key={c.id} chat={c} agoraMs={agoraMs} ativo={selecionado === c.id} onClick={() => onSelecionar(c.id)} />
            ))}
          </div>
        ) : (
          !vivo && (
            <EstadoVazio
              className="py-8"
              icone={MessageCircle}
              titulo="Nenhuma conversa ainda"
              descricao="Fale com um atendente agora — se ninguém puder atender, a conversa vira um chamado automaticamente."
            />
          )
        )}
      </div>
    </div>
  )
}

/**
 * Chat do Painel do Cliente.
 *
 * Ordem das regras (a tela segue exatamente a ordem do backend):
 * 1. Avaliação pendente TRAVA tudo — modal sem saída sobre a página inteira.
 * 2. Conversa viva (fila ou em atendimento), se houver.
 * 3. Histórico completo, sempre visível e navegável mesmo com uma conversa
 *    viva ao lado.
 * "Novo chat" fica desabilitado com avaliação pendente ou fila fechada —
 * nunca escondido: a pessoa precisa entender por quê.
 */
export function PaginaChat() {
  const [params, setParams] = useSearchParams()
  const agora = useAgora()
  const vivo = useMeuChatVivo()
  const pendentes = usePendingRatings()
  const config = useConfigChat()
  const historico = useHistoricoChats()
  const abrir = useAbrirChat()
  const [pendentesDoAbrir, setPendentesDoAbrir] = useState<Chat[]>([])
  const [erroAbrir, setErroAbrir] = useState<{ detail: string; code?: string } | null>(null)

  const chatParam = params.get('chat')
  const selecionadoId = chatParam && /^\d+$/.test(chatParam) ? Number(chatParam) : null
  const pendente = pendentes.data?.[0] ?? pendentesDoAbrir[0] ?? null

  function selecionar(id: number) {
    setParams({ chat: String(id) }, { replace: true })
  }
  function voltarParaLista() {
    setParams({}, { replace: true })
  }

  function iniciar() {
    if (vivo.data) {
      selecionar(vivo.data.id)
      return
    }
    setErroAbrir(null)
    abrir.mutate(undefined, {
      onSuccess: (chat) => selecionar(chat.id),
      onError: (e) => {
        const p = pendentesDoErro(e)
        if (p.length > 0) {
          setPendentesDoAbrir(p)
          return
        }
        setErroAbrir({
          detail: e instanceof ApiError ? (e.detail ?? 'Não foi possível abrir o chat.') : 'Não foi possível abrir o chat.',
          code: e instanceof ApiError ? e.code : undefined,
        })
        toast.error(e instanceof ApiError ? (e.detail ?? 'Não foi possível abrir o chat.') : 'Não foi possível abrir o chat.')
      },
    })
  }

  const filaFechada = config.data?.queue_open === false
  const bloqueadoPorAvaliacao = pendente != null
  const travado = bloqueadoPorAvaliacao || (filaFechada && !vivo.data)
  const motivoTravado = bloqueadoPorAvaliacao
    ? 'Avalie o último atendimento antes de iniciar outro'
    : filaFechada
      ? `Fora do horário de atendimento${config.data?.queue_opens_at ? ` — volta ${dataHora(config.data.queue_opens_at)}` : ''}`
      : undefined

  const conversaSelecionada = selecionadoId ?? vivo.data?.id ?? null

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-4 md:h-[calc(100vh-6rem)]">
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border border-divisoria bg-superficie shadow-elevacao-1 md:grid-cols-[320px_1fr]">
        <div className={conversaSelecionada != null ? 'hidden border-divisoria md:block md:border-r' : 'border-divisoria md:block md:border-r'}>
          <Lista
            vivo={vivo.data}
            historico={historico.data}
            carregandoHistorico={historico.isLoading}
            selecionado={conversaSelecionada}
            agoraMs={agora}
            onSelecionar={selecionar}
            onIniciar={iniciar}
            iniciando={abrir.isPending}
            travado={travado}
            motivoTravado={motivoTravado}
          />
        </div>

        <div className={conversaSelecionada != null ? 'min-h-0' : 'hidden min-h-0 md:block'}>
          {conversaSelecionada != null ? (
            <Conversa chatId={conversaSelecionada} onVoltar={voltarParaLista} />
          ) : filaFechada && !bloqueadoPorAvaliacao ? (
            <EstadoVazio
              className="h-full justify-center"
              icone={Clock}
              titulo="Fora do horário de atendimento por chat"
              descricao={
                config.data?.queue_opens_at
                  ? `Volta ${dataHora(config.data.queue_opens_at)}. Abra um ticket e a equipe responde assim que o expediente começar.`
                  : 'Abra um ticket e a equipe responde assim que o expediente começar.'
              }
              acao={
                <Link to="/portal/tickets/novo" className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                  Abrir ticket
                </Link>
              }
            />
          ) : (
            <EstadoVazio
              className="h-full justify-center"
              icone={MessageCircle}
              titulo="Selecione uma conversa"
              descricao="Escolha uma conversa na lista ou inicie um novo chat."
            />
          )}
        </div>
      </div>

      {erroAbrir && (
        <Alert variant="destructive" titulo="Não foi possível iniciar o chat">
          {erroAbrir.detail}
          {erroAbrir.code === 'fora_do_expediente' && (
            <span className="mt-1 flex items-center gap-1 text-legenda">
              <AlertCircle className="size-3.5" aria-hidden="true" /> Abra um ticket — a equipe responde assim que o expediente começar.
            </span>
          )}
        </Alert>
      )}

      {pendente && <ModalAvaliacao chat={pendente} config={config.data} />}
    </div>
  )
}
