import { Link } from 'react-router-dom'
import { quandoReabre } from '@/ui/reabertura'
import { IconClock, IconHeadset, IconMessageCircle, IconMessagePlus, IconPlus, IconStar, IconTicket, type Icon } from '@tabler/icons-react'
import { useConfigChat, usePendingRatings, type Chat } from '@/api/chat'
import { useMe } from '@/api/queries/useMe'
import { useChatsRecentes, useContagemChatsAtivos } from '../api/chats'
import { useAvaliacoesPendentesTicket, useContagemAbas, useTicketsRecentes } from '../api/tickets'
import { cn } from '../lib/cn'
import { primeiroNome, relativo, useAgora } from '../lib/formato'
import { CartaoTicket, EsqueletoCartaoTicket, HOVER_CARTAO } from '../tickets/componentes'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button, buttonVariants } from '../ui/button'
import { Card } from '../ui/card'
import { EstadoVazio } from '../ui/estado-vazio'
import { Skeleton } from '../ui/skeleton'
import { MuralAvisos } from './MuralAvisos'

interface CartaoResumoProps {
  rotulo: string
  valor: number | undefined
  icone: Icon
  para: string
  /** Realce quando a bola está com a pessoa. */
  destaque?: boolean
  ajuda?: string
}

/** Cartão de número: branco sobre o plano, sem linha; o destaque (quando a
 *  bola está com a pessoa) é a cor do número e do ícone, que é estado. */
function CartaoResumo({ rotulo, valor, icone: Icone, para, destaque, ajuda }: CartaoResumoProps) {
  const ativo = destaque && (valor ?? 0) > 0
  return (
    <Link
      to={para}
      className={cn('group flex flex-col gap-3 rounded-md bg-superficie p-4 md:p-5', HOVER_CARTAO)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-pequeno font-medio text-tinta-secundaria">{rotulo}</span>
        <span className={cn('grid size-8 place-items-center rounded-md bg-navegacao text-tinta-secundaria', ativo && 'bg-alerta-suave text-alerta')}>
          <Icone className="size-4" aria-hidden="true" />
        </span>
      </div>
      {valor === undefined ? (
        <Skeleton className="h-8 w-12" />
      ) : (
        <span className={cn('text-display font-forte leading-nenhuma tabular-nums text-tinta', ativo && 'text-alerta')}>{valor}</span>
      )}
      {/* Sem a seta que vinha colada no rótulo. O cartão inteiro é o alvo do
          clique — a seta repetia por grafismo o que a própria palavra já
          diz, e três delas lado a lado viravam ruído numa fileira que
          deveria ser só número e rótulo. */}
      <span className="text-legenda text-tinta-secundaria">{ajuda ?? 'Ver'}</span>
    </Link>
  )
}

const ROTULO_CHAT: Record<Chat['status'], { rotulo: string; tom: 'acento' | 'ok' | 'neutro' }> = {
  queued: { rotulo: 'Na fila', tom: 'acento' },
  active: { rotulo: 'Em atendimento', tom: 'ok' },
  closed: { rotulo: 'Encerrada', tom: 'neutro' },
}

function LinhaChat({ chat, agoraMs }: { chat: Chat; agoraMs: number }) {
  const s = ROTULO_CHAT[chat.status]
  return (
    <Link
      to={`/portal/chat?chat=${chat.id}`}
      className={cn('group flex items-center gap-3 rounded-md bg-superficie p-4', HOVER_CARTAO)}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-total bg-navegacao text-tinta-secundaria">
        <IconHeadset className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-corpo font-medio">
          {chat.agent_name ? `Conversa com ${chat.agent_name}` : 'Aguardando um atendente'}
        </span>
        <span className="block truncate text-legenda text-tinta-secundaria">
          {chat.last_message_preview ?? 'Sem mensagens ainda'}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {chat.rating_pending ? (
          <Badge variant="alerta" ponto>
            Avaliação pendente
          </Badge>
        ) : (
          <Badge variant={s.tom} ponto>
            {s.rotulo}
          </Badge>
        )}
        <span className="text-legenda text-tinta-secundaria">{relativo(chat.queued_at, agoraMs)}</span>
      </span>
    </Link>
  )
}

/**
 * Início do Painel do Cliente: o que precisa de você, o que está com o
 * suporte, e os dois atalhos que importam. Um alerta sobe quando há
 * avaliação pendente — é a regra que trava o próximo chat. O estado da fila
 * de chat vem na saudação (como na Início do console): a pessoa sabe ANTES
 * de clicar se vai falar com alguém agora ou não.
 */
export function PaginaInicio() {
  const { data: me } = useMe()
  const agora = useAgora()
  const contagens = useContagemAbas()
  const chatsAtivos = useContagemChatsAtivos()
  const config = useConfigChat()
  const { data: chatsPendentes } = usePendingRatings()
  const { data: ticketsPendentes } = useAvaliacoesPendentesTicket()
  const recentes = useTicketsRecentes(5)
  const chats = useChatsRecentes(5)

  const aguardandoSuporte =
    contagens['aguardando-suporte'] === undefined || contagens['em-andamento'] === undefined
      ? undefined
      : contagens['aguardando-suporte'] + contagens['em-andamento']
  const pendentesChat = chatsPendentes?.length ?? 0
  const pendentesTicket = ticketsPendentes?.length ?? 0
  const avaliacoesPendentes =
    chatsPendentes === undefined && ticketsPendentes === undefined ? undefined : pendentesChat + pendentesTicket

  const filaAberta = config.data?.queue_open
  const filaFechada = filaAberta === false
  const voltaAs = config.data?.queue_opens_at ? quandoReabre(config.data.queue_opens_at) : null
  // Dois motivos travam o chat, e a pessoa precisa saber qual: a avaliação
  // pendente (dela) ou o horário (do suporte).
  const motivoChatTravado =
    pendentesChat > 0
      ? 'Avalie o último chat para iniciar outro'
      : filaFechada
        ? `Fora do horário de atendimento por chat${voltaAs ? `. Volta ${voltaAs}` : ''}`
        : null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {/* O mesmo título de toda página do portal: 28px, peso 600. */}
          <h1 className="text-titulo-lg font-forte text-tinta">
            {me ? `Olá, ${primeiroNome(me.full_name)}` : <Skeleton className="h-8 w-40" />}
          </h1>
          <p className="mt-1 text-corpo text-tinta-secundaria">
            {me?.company_name ? `${me.company_name} · ` : ''}Acompanhe seus chamados e fale com o suporte.
            {filaAberta != null && (
              <>
                {' · '}
                <span className={cn('font-medio', filaAberta ? 'text-ok' : 'text-tinta-terciaria')}>
                  {filaAberta ? 'Chat aberto agora' : `Chat fechado${voltaAs ? `, volta ${voltaAs}` : ''}`}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to="/portal/tickets/novo" className={buttonVariants({ variant: 'default' })}>
            <IconPlus /> Abrir ticket
          </Link>
          {motivoChatTravado ? (
            <Button variant="secondary" disabled title={motivoChatTravado}>
              <IconMessagePlus /> Iniciar chat
            </Button>
          ) : (
            <Link to="/portal/chat" className={buttonVariants({ variant: 'secondary' })}>
              <IconMessagePlus /> Iniciar chat
            </Link>
          )}
        </div>
      </header>

      <MuralAvisos />

      {pendentesChat > 0 && (
        <Alert
          variant="warning"
          titulo="Você tem uma avaliação de chat pendente"
          acao={
            <Link to="/portal/chat" className={buttonVariants({ size: 'sm' })}>
              Avaliar agora
            </Link>
          }
        >
          Avalie a última conversa para poder iniciar um novo chat. Leva menos de um minuto.
        </Alert>
      )}
      {pendentesTicket > 0 && (
        <Alert
          variant="info"
          titulo={pendentesTicket === 1 ? 'Um chamado resolvido aguarda sua avaliação' : `${pendentesTicket} chamados resolvidos aguardam sua avaliação`}
          acao={
            <Link to={`/portal/tickets/${ticketsPendentes![0].ticket_id}`} className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
              Avaliar {ticketsPendentes![0].reference}
            </Link>
          }
        >
          Sua nota ajuda o suporte a melhorar.
        </Alert>
      )}

      <section aria-label="Resumo" className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <CartaoResumo
          rotulo="Aguardando seu retorno"
          valor={contagens['aguardando-voce']}
          icone={IconClock}
          para="/portal/tickets?aba=aguardando-voce"
          destaque
          ajuda="Responder"
        />
        <CartaoResumo
          rotulo="Aguardando suporte"
          valor={aguardandoSuporte}
          icone={IconTicket}
          para="/portal/tickets?aba=aguardando-suporte"
          ajuda={contagens['em-andamento'] ? `${contagens['em-andamento']} em andamento` : undefined}
        />
        <CartaoResumo rotulo="Chats ativos" valor={chatsAtivos.data} icone={IconMessageCircle} para="/portal/chat" />
        <CartaoResumo
          rotulo="Avaliações pendentes"
          valor={avaliacoesPendentes}
          icone={IconStar}
          para={pendentesChat > 0 ? '/portal/chat' : '/portal/historico'}
          destaque
          ajuda="Avaliar"
        />
      </section>

      {/* As duas listas direto no plano, cada item um cartão — sem o cartão
          em volta que havia aqui: cartão branco dentro de cartão branco não
          tem borda que o separe, e a lista virava texto solto. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="inicio-tickets" className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 id="inicio-tickets" className="text-titulo font-forte">
              Tickets recentes
            </h2>
            <Link to="/portal/tickets" className="rounded-sm text-corpo font-medio text-tinta hover:underline">
              Ver todos
            </Link>
          </div>
          {recentes.isLoading ? (
            [0, 1, 2].map((i) => <EsqueletoCartaoTicket key={i} />)
          ) : recentes.data && recentes.data.length > 0 ? (
            recentes.data.map((t) => <CartaoTicket key={t.id} ticket={t} agoraMs={agora} compacto />)
          ) : (
            <Card>
              <EstadoVazio
                icone={IconTicket}
                titulo="Nenhum ticket ainda"
                descricao="Quando precisar de ajuda, abra um ticket. Você acompanha tudo por aqui."
                acao={
                  <Link to="/portal/tickets/novo" className={buttonVariants({ size: 'sm' })}>
                    <IconPlus /> Abrir ticket
                  </Link>
                }
              />
            </Card>
          )}
        </section>

        <section aria-labelledby="inicio-conversas" className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 id="inicio-conversas" className="text-titulo font-forte">
              Conversas recentes
            </h2>
            <Link to="/portal/chat" className="rounded-sm text-corpo font-medio text-tinta hover:underline">
              Ver todas
            </Link>
          </div>
          {chats.isLoading ? (
            [0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-md bg-superficie p-4">
                <Skeleton className="size-9 rounded-total" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))
          ) : chats.data && chats.data.length > 0 ? (
            chats.data.map((c) => <LinhaChat key={c.id} chat={c} agoraMs={agora} />)
          ) : (
            <Card>
              <EstadoVazio
                icone={IconMessageCircle}
                titulo="Nenhuma conversa ainda"
                descricao={
                  filaFechada
                    ? `O chat está fechado agora${voltaAs ? ` e volta ${voltaAs}` : ''}. Para uma dúvida curta, ele é o caminho mais rápido dentro do horário de atendimento.`
                    : 'O chat é o caminho mais rápido para uma dúvida curta, dentro do horário de atendimento.'
                }
                acao={
                  motivoChatTravado ? (
                    <Link to="/portal/tickets/novo" className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                      <IconPlus /> Abrir ticket
                    </Link>
                  ) : (
                    <Link to="/portal/chat" className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                      <IconMessagePlus /> Iniciar chat
                    </Link>
                  )
                }
              />
            </Card>
          )}
        </section>
      </div>
    </div>
  )
}
