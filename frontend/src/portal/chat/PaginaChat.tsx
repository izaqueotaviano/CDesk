import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { IconAlertCircle, IconClock, IconHistory, IconMessageCircle, IconMessagePlus } from '@tabler/icons-react'
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
import { cn } from '../lib/cn'
import { dataHora, useAgora } from '../lib/formato'
import { Alert } from '../ui/alert'
import { Button, buttonVariants } from '../ui/button'
import { ErroEstado, EstadoVazio } from '../ui/estado-vazio'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { CartaoConversa } from './componentes'
import { Conversa } from './Conversa'
import { ConversaContinua } from './ConversaContinua'
import { DialogConversaEncerrada, ModalAvaliacao } from './ModalAvaliacao'

/** Sentinela de `?chat=` pra ver a linha do tempo costurada em vez de uma
 *  sessão só — nunca colide com um id real (`/^\d+$/`). */
const PARAM_CONTINUA = 'continua'

function Lista({
  vivo,
  historico,
  carregandoHistorico,
  erroHistorico,
  onRecarregarHistorico,
  selecionado,
  mostrandoContinua,
  agoraMs,
  onSelecionar,
  onVerContinua,
  onIniciar,
  iniciando,
  travado,
  motivoTravado,
}: {
  vivo: Chat | null | undefined
  historico: Chat[] | undefined
  carregandoHistorico: boolean
  /** Histórico que FALHOU não é histórico vazio: a tela precisa distinguir os dois. */
  erroHistorico: boolean
  onRecarregarHistorico: () => void
  selecionado: number | null
  mostrandoContinua: boolean
  agoraMs: number
  onSelecionar: (id: number) => void
  onVerContinua: () => void
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
          <IconMessagePlus /> {iniciando ? 'Abrindo…' : vivo ? 'Continuar' : 'Novo chat'}
        </Button>
      </div>

      {historico && historico.length > 0 && (
        <button
          type="button"
          onClick={onVerContinua}
          aria-current={mostrandoContinua || undefined}
          className={cn(
            'mx-2 mt-2 flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-pequeno font-medio text-tinta-secundaria transition-colors hover:bg-navegacao hover:text-tinta',
            mostrandoContinua && 'border-acento/30 bg-acento-suave text-tinta hover:bg-acento-suave',
          )}
        >
          <IconHistory className="size-4" aria-hidden="true" /> Ver conversa completa
        </button>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {vivo && (
          <div className="mb-2">
            <p className="px-2 py-1 text-legenda font-medio text-tinta-secundaria">Conversa atual</p>
            <CartaoConversa chat={vivo} agoraMs={agoraMs} ativo={selecionado === vivo.id && !mostrandoContinua} onClick={() => onSelecionar(vivo.id)} />
          </div>
        )}

        <p className="px-2 py-1 text-legenda font-medio text-tinta-secundaria">Histórico</p>
        {carregandoHistorico ? (
          <div className="space-y-2 p-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : erroHistorico ? (
          <ErroEstado
            className="py-6"
            titulo="Não foi possível carregar o histórico"
            descricao="Suas conversas continuam guardadas — só não deu para buscá-las agora."
            onTentarNovamente={onRecarregarHistorico}
          />
        ) : historico && historico.length > 0 ? (
          <div className="flex flex-col">
            {historico.map((c) => (
              <CartaoConversa key={c.id} chat={c} agoraMs={agoraMs} ativo={selecionado === c.id && !mostrandoContinua} onClick={() => onSelecionar(c.id)} />
            ))}
          </div>
        ) : (
          !vivo && (
            <EstadoVazio
              className="py-8"
              icone={IconMessageCircle}
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
  const [encerrada, setEncerrada] = useState(false)

  const chatParam = params.get('chat')
  const mostrandoContinua = chatParam === PARAM_CONTINUA
  const selecionadoId = chatParam && /^\d+$/.test(chatParam) ? Number(chatParam) : null
  const pendente = pendentes.data?.[0] ?? pendentesDoAbrir[0] ?? null

  function selecionar(id: number) {
    setParams({ chat: String(id) }, { replace: true })
  }
  function verContinua() {
    setParams({ chat: PARAM_CONTINUA }, { replace: true })
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
  const algoAberto = mostrandoContinua || conversaSelecionada != null

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-4 md:h-[calc(100vh-6rem)]">
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-md border border-divisoria bg-superficie md:grid-cols-[320px_1fr]">
        <div className={algoAberto ? 'hidden border-divisoria md:block md:border-r' : 'border-divisoria md:block md:border-r'}>
          <Lista
            vivo={vivo.data}
            historico={historico.data}
            carregandoHistorico={historico.isLoading}
            erroHistorico={historico.isError}
            onRecarregarHistorico={() => historico.refetch()}
            selecionado={conversaSelecionada}
            mostrandoContinua={mostrandoContinua}
            agoraMs={agora}
            onSelecionar={selecionar}
            onVerContinua={verContinua}
            onIniciar={iniciar}
            iniciando={abrir.isPending}
            travado={travado}
            motivoTravado={motivoTravado}
          />
        </div>

        <div className={algoAberto ? 'min-h-0' : 'hidden min-h-0 md:block'}>
          {mostrandoContinua ? (
            <ConversaContinua onVoltar={voltarParaLista} />
          ) : conversaSelecionada != null ? (
            <Conversa
              chatId={conversaSelecionada}
              onVoltar={voltarParaLista}
              onEncerrada={() => {
                // fixa o chat na URL: encerrado ele sai da "conversa viva", e
                // sem isso a seleção caía para null e o cliente era jogado numa
                // lista vazia logo depois de avaliar.
                selecionar(conversaSelecionada)
                setEncerrada(true)
              }}
            />
          ) : filaFechada && !bloqueadoPorAvaliacao ? (
            <EstadoVazio
              className="h-full justify-center"
              icone={IconClock}
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
              icone={IconMessageCircle}
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
              <IconAlertCircle className="size-3.5" aria-hidden="true" /> Abra um ticket — a equipe responde assim que o expediente começar.
            </span>
          )}
        </Alert>
      )}

      {encerrada && <DialogConversaEncerrada onFechar={() => setEncerrada(false)} />}
      {!encerrada && pendente && <ModalAvaliacao chat={pendente} config={config.data} />}
    </div>
  )
}
