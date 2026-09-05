import { Link } from 'react-router-dom'
import { ArrowRight, Clock, Headset, MessageCircle, MessageSquarePlus, Plus, Star, Ticket, type LucideIcon } from 'lucide-react'
import { usePendingRatings, type Chat } from '@/api/chat'
import { useMe } from '@/api/queries/useMe'
import { useChatsRecentes, useContagemChatsAtivos } from '../api/chats'
import { useAvaliacoesPendentesTicket, useContagemAbas, useTicketsRecentes } from '../api/tickets'
import { cn } from '../lib/cn'
import { primeiroNome, relativo, useAgora } from '../lib/formato'
import { CartaoTicket, EsqueletoCartaoTicket } from '../tickets/componentes'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button, buttonVariants } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { EstadoVazio } from '../ui/estado-vazio'
import { Skeleton } from '../ui/skeleton'

interface CartaoResumoProps {
  rotulo: string
  valor: number | undefined
  icone: LucideIcon
  para: string
  /** Realce quando a bola está com a pessoa. */
  destaque?: boolean
  ajuda?: string
}

function CartaoResumo({ rotulo, valor, icone: Icone, para, destaque, ajuda }: CartaoResumoProps) {
  const ativo = destaque && (valor ?? 0) > 0
  return (
    <Link
      to={para}
      className={cn(
        'group flex flex-col gap-3 rounded-xl border border-divisoria bg-superficie p-5 shadow-elevacao-1 transition-[border-color,box-shadow] hover:border-borda-controle hover:shadow-elevacao-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40',
        ativo && 'border-alerta/40 bg-alerta-suave/30',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-pequeno font-medio text-tinta-secundaria">{rotulo}</span>
        <span className={cn('grid size-8 place-items-center rounded-lg bg-navegacao text-tinta-secundaria', ativo && 'bg-alerta-suave text-alerta')}>
          <Icone className="size-4" aria-hidden="true" />
        </span>
      </div>
      {valor === undefined ? (
        <Skeleton className="h-8 w-12" />
      ) : (
        <span className={cn('text-display font-forte leading-nenhuma text-tinta', ativo && 'text-alerta')}>{valor}</span>
      )}
      <span className="flex items-center gap-1 text-legenda text-tinta-terciaria">
        {ajuda ?? 'Ver'}
        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
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
      className="group flex items-center gap-3 rounded-xl border border-divisoria bg-superficie p-4 shadow-elevacao-1 transition-[border-color,box-shadow] hover:border-borda-controle hover:shadow-elevacao-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-total bg-navegacao text-tinta-secundaria">
        <Headset className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-corpo font-medio group-hover:text-acento">
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
        <span className="text-legenda text-tinta-terciaria">{relativo(chat.queued_at, agoraMs)}</span>
      </span>
    </Link>
  )
}

/**
 * Início do Painel do Cliente: o que precisa de você, o que está com o
 * suporte, e os dois atalhos que importam. Um alerta sobe quando há
 * avaliação pendente — é a regra que trava o próximo chat.
 */
export function PaginaInicio() {
  const { data: me } = useMe()
  const agora = useAgora()
  const contagens = useContagemAbas()
  const chatsAtivos = useContagemChatsAtivos()
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
  const chatBloqueado = pendentesChat > 0

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-titulo-lg font-forte tracking-display">
            {me ? `Olá, ${primeiroNome(me.full_name)}` : <Skeleton className="h-7 w-40" />}
          </h1>
          <p className="mt-1 text-pequeno text-tinta-secundaria">
            {me?.company_name ? `${me.company_name} · ` : ''}Acompanhe seus chamados e fale com o suporte.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to="/portal/tickets/novo" className={buttonVariants({ variant: 'default' })}>
            <Plus /> Abrir ticket
          </Link>
          {chatBloqueado ? (
            <Button variant="secondary" disabled title="Avalie o último chat para iniciar outro">
              <MessageSquarePlus /> Iniciar chat
            </Button>
          ) : (
            <Link to="/portal/chat" className={buttonVariants({ variant: 'secondary' })}>
              <MessageSquarePlus /> Iniciar chat
            </Link>
          )}
        </div>
      </header>

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
          icone={Clock}
          para="/portal/tickets?aba=aguardando-voce"
          destaque
          ajuda="Responder"
        />
        <CartaoResumo
          rotulo="Aguardando suporte"
          valor={aguardandoSuporte}
          icone={Ticket}
          para="/portal/tickets?aba=aguardando-suporte"
          ajuda={contagens['em-andamento'] ? `${contagens['em-andamento']} em andamento` : undefined}
        />
        <CartaoResumo rotulo="Chats ativos" valor={chatsAtivos.data} icone={MessageCircle} para="/portal/chat" />
        <CartaoResumo
          rotulo="Avaliações pendentes"
          valor={avaliacoesPendentes}
          icone={Star}
          para={pendentesChat > 0 ? '/portal/chat' : '/portal/historico'}
          destaque
          ajuda="Avaliar"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Tickets recentes</CardTitle>
            <Link to="/portal/tickets" className="text-pequeno font-medio text-acento hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentes.isLoading ? (
              [0, 1, 2].map((i) => <EsqueletoCartaoTicket key={i} />)
            ) : recentes.data && recentes.data.length > 0 ? (
              recentes.data.map((t) => <CartaoTicket key={t.id} ticket={t} agoraMs={agora} compacto />)
            ) : (
              <EstadoVazio
                icone={Ticket}
                titulo="Nenhum ticket ainda"
                descricao="Quando precisar de ajuda, abra um ticket — você acompanha tudo por aqui."
                acao={
                  <Link to="/portal/tickets/novo" className={buttonVariants({ size: 'sm' })}>
                    <Plus /> Abrir ticket
                  </Link>
                }
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Conversas recentes</CardTitle>
            <Link to="/portal/chat" className="text-pequeno font-medio text-acento hover:underline">
              Ver todas
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {chats.isLoading ? (
              [0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-divisoria p-4">
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
              <EstadoVazio
                icone={MessageCircle}
                titulo="Nenhuma conversa ainda"
                descricao="O chat é o caminho mais rápido para uma dúvida curta, dentro do horário de atendimento."
                acao={
                  chatBloqueado ? undefined : (
                    <Link to="/portal/chat" className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                      <MessageSquarePlus /> Iniciar chat
                    </Link>
                  )
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
