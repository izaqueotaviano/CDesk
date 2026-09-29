import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { IconArrowRight, IconChevronLeft, IconChevronRight, IconHeadset, IconHistory, IconMessageCircle, IconSearch, IconStar, IconTicket, IconX, IconZoomCancel, type Icon } from '@tabler/icons-react'
import { useConfigChat, usePendingRatings, type Chat } from '@/api/chat'
import { ApiError } from '@/api/client'
import { useChatsEncerrados, useContagemHistorico, useTicketsEncerrados, type FiltroAvaliacao } from '../api/historico'
import { useAvaliacoesPendentesTicket, type TicketResumo } from '../api/tickets'
import { cn } from '../lib/cn'
import { dataCurta, dataHora, duracaoEntre, primeiroNome, relativo, useAgora } from '../lib/formato'
import { EsqueletoCartaoTicket, PilulaStatus } from '../tickets/componentes'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button, buttonVariants } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { EstadoVazio } from '../ui/estado-vazio'
import { Input, Label, Select } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'

const LIMITE_TICKETS = 10
const PASSO_CHATS = 20

type Aba = 'tickets' | 'chats'
type Periodo = '' | '30' | '90' | 'ano'

const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: '', rotulo: 'Qualquer data' },
  { valor: '30', rotulo: 'Últimos 30 dias' },
  { valor: '90', rotulo: 'Últimos 90 dias' },
  { valor: 'ano', rotulo: 'Este ano' },
]

const AVALIACOES: { valor: FiltroAvaliacao; rotulo: string }[] = [
  { valor: '', rotulo: 'Todos' },
  { valor: 'sim', rotulo: 'Avaliados' },
  { valor: 'nao', rotulo: 'Sem avaliação' },
]

/** `desde=` em ISO (só a data) para o recorte de período. */
function desdeDoPeriodo(periodo: Periodo, agoraMs: number): string | undefined {
  if (!periodo) return undefined
  const d = new Date(agoraMs)
  if (periodo === 'ano') return `${d.getFullYear()}-01-01`
  d.setDate(d.getDate() - Number(periodo))
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Resumo do topo
// ---------------------------------------------------------------------------

/** Três números lado a lado — no celular ficam compactos (três colunas
 *  estreitas), não três cartões altos empilhados. */
function CartaoNumero({ rotulo, valor, icone: Icone, detalhe }: { rotulo: string; valor: number | undefined; icone: Icon; detalhe?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl  bg-superficie p-3 sm:gap-3 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-legenda font-medio text-tinta-secundaria sm:text-pequeno">{rotulo}</span>
        <span className="hidden size-8 place-items-center rounded-lg bg-navegacao text-tinta-secundaria sm:grid">
          <Icone className="size-4" aria-hidden="true" />
        </span>
      </div>
      {valor === undefined ? (
        <Skeleton className="h-7 w-10 sm:h-8 sm:w-12" />
      ) : (
        <span className="text-titulo-lg font-forte leading-nenhuma text-tinta sm:text-display">{valor}</span>
      )}
      {detalhe && <span className="text-legenda text-tinta-terciaria">{detalhe}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// A avaliação de cada linha
// ---------------------------------------------------------------------------

function NotaTicket({ ticket, pendente }: { ticket: TicketResumo; pendente: boolean }) {
  const nota = ticket.satisfaction?.score
  if (nota != null) {
    return (
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ok-suave text-corpo-lg font-forte text-ok" aria-hidden="true">
          {nota}
        </span>
        <span className="min-w-0">
          <span className="block text-pequeno font-medio text-tinta">Nota {nota} de 10</span>
          {ticket.satisfaction?.comment ? (
            <span className="line-clamp-2 text-legenda text-tinta-secundaria" title={ticket.satisfaction.comment}>
              “{ticket.satisfaction.comment}”
            </span>
          ) : (
            <span className="block text-legenda text-tinta-terciaria">Sem comentário</span>
          )}
        </span>
      </div>
    )
  }
  if (pendente) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Link to={`/portal/tickets/${ticket.id}`} className={buttonVariants({ size: 'sm' })}>
          <IconStar /> Avaliar
        </Link>
        <span className="text-legenda text-tinta-terciaria">Pesquisa aberta</span>
      </div>
    )
  }
  return <span className="text-legenda text-tinta-terciaria">Sem avaliação</span>
}

function NotaChat({ chat, max }: { chat: Chat; max: number }) {
  if (chat.rating) {
    return (
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap gap-1.5">
          <Badge variant="ok">Atendimento {chat.rating.service_score}/{max}</Badge>
          <Badge variant={chat.rating.resolution_score * 2 >= max ? 'ok' : 'alerta'}>Resolução {chat.rating.resolution_score}/{max}</Badge>
        </span>
        {chat.rating.justification && (
          <span className="line-clamp-2 text-legenda text-tinta-secundaria" title={chat.rating.justification}>
            “{chat.rating.justification}”
          </span>
        )}
      </div>
    )
  }
  if (chat.rating_pending) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Link to="/portal/chat" className={buttonVariants({ size: 'sm' })}>
          <IconStar /> Avaliar
        </Link>
        <span className="text-legenda text-tinta-terciaria">Libera o próximo chat</span>
      </div>
    )
  }
  if (chat.ticket_id) {
    return (
      <Link to={`/portal/tickets/${chat.ticket_id}`} className="inline-flex items-center gap-1 text-pequeno text-acento hover:underline">
        Continuou no chamado {chat.ticket_reference} <IconArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    )
  }
  return <span className="text-legenda text-tinta-terciaria">Sem avaliação</span>
}

// ---------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------

function LinhaTicket({ ticket, pendente }: { ticket: TicketResumo; pendente: boolean }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl  bg-superficie p-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="fonte-mono text-legenda text-acento">{ticket.reference}</span>
          <PilulaStatus ticket={ticket} />
        </div>
        <Link to={`/portal/tickets/${ticket.id}`} className="mt-0.5 block truncate text-corpo font-medio text-tinta hover:text-acento focus-visible:outline-none focus-visible:underline">
          {ticket.content_hidden ? 'Chamado restrito' : ticket.subject}
        </Link>
        <p className="mt-0.5 text-legenda text-tinta-secundaria">
          {ticket.auto_closed ? 'Fechado' : 'Resolvido'} em {dataCurta(ticket.closed_at)}
          {ticket.category_name && ` · ${ticket.category_name}`} · aberto em {dataCurta(ticket.created_at)}
        </p>
      </div>
      <div className="sm:w-60 sm:shrink-0">
        <NotaTicket ticket={ticket} pendente={pendente} />
      </div>
    </li>
  )
}

function LinhaChat({ chat, max, agoraMs }: { chat: Chat; max: number; agoraMs: number }) {
  const duracao = duracaoEntre(chat.accepted_at, chat.closed_at)
  // recente: "há 2 h (04/09/2026, 12:15)"; mais velho que uma semana só a data
  const rel = relativo(chat.closed_at ?? chat.queued_at, agoraMs)
  const quando = rel.startsWith('há') || rel === 'agora' ? `${rel} (${dataHora(chat.closed_at)})` : `em ${dataHora(chat.closed_at)}`
  return (
    <li className="flex flex-col gap-3 rounded-xl  bg-superficie p-4 sm:flex-row sm:items-center sm:gap-4">
      <span className="hidden size-10 shrink-0 place-items-center rounded-total bg-navegacao text-tinta-secundaria sm:grid">
        <IconHeadset className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <Link to={`/portal/chat?chat=${chat.id}`} className="block truncate text-corpo font-medio text-tinta hover:text-acento focus-visible:outline-none focus-visible:underline">
          {chat.agent_name ? `Conversa com ${chat.agent_name}` : 'Conversa sem atendimento'}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-legenda text-tinta-secundaria">
          <span>Encerrada {quando}</span>
          {duracao && <span>· {duracao} de atendimento</span>}
          {chat.timeout_converted && <Badge variant="neutro">não atendida</Badge>}
        </p>
      </div>
      <div className="sm:w-60 sm:shrink-0">
        <NotaChat chat={chat} max={max} />
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

/**
 * Histórico: o que já terminou — chamados resolvidos ou fechados e conversas
 * encerradas — com a avaliação que a pessoa deu, ou o botão para dar. É para
 * cá que o cartão "Avaliações pendentes" do Início manda. Aba, busca e
 * filtros moram na URL (F5 e link compartilhado voltam ao mesmo lugar).
 */
export function PaginaHistorico() {
  const [params, setParams] = useSearchParams()
  const agora = useAgora()

  const aba: Aba = params.get('aba') === 'chats' ? 'chats' : 'tickets'
  const q = params.get('q') ?? ''
  const avaliacaoParam = params.get('avaliacao')
  const avaliacao: FiltroAvaliacao = avaliacaoParam === 'sim' || avaliacaoParam === 'nao' ? avaliacaoParam : ''
  const periodoParam = params.get('periodo')
  const periodo: Periodo = PERIODOS.some((p) => p.valor === periodoParam) ? (periodoParam as Periodo) : ''
  const pagina = Math.max(1, Number(params.get('pagina') ?? 1) || 1)

  const definir = useCallback(
    (mudancas: Record<string, string | undefined>, opcoes: { manterPagina?: boolean } = {}) => {
      setParams(
        (atual) => {
          const novo = new URLSearchParams(atual)
          for (const [k, v] of Object.entries(mudancas)) {
            if (v) novo.set(k, v)
            else novo.delete(k)
          }
          if (!opcoes.manterPagina) novo.delete('pagina')
          return novo
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // busca com folga: a URL (e a consulta) só muda 300 ms depois da última tecla
  const [busca, setBusca] = useState(q)
  useEffect(() => {
    const alvo = busca.trim()
    if (alvo === q) return
    const h = setTimeout(() => definir({ q: alvo || undefined }), 300)
    return () => clearTimeout(h)
  }, [busca, q, definir])

  const contagens = useContagemHistorico()
  const { data: ticketsPendentes } = useAvaliacoesPendentesTicket()
  const { data: chatsPendentes } = usePendingRatings()
  const configChat = useConfigChat()
  const maxChat = configChat.data?.score_max ?? 10

  const tickets = useTicketsEncerrados({
    avaliacao,
    q: q || undefined,
    desde: desdeDoPeriodo(periodo, agora),
    limit: LIMITE_TICKETS,
    offset: (pagina - 1) * LIMITE_TICKETS,
  })
  const [limiteChats, setLimiteChats] = useState(PASSO_CHATS)
  const chats = useChatsEncerrados(limiteChats)

  const idsPendentes = new Set((ticketsPendentes ?? []).map((p) => p.ticket_id))
  const totalTickets = tickets.data?.count ?? 0
  const ultimaPagina = Math.max(1, Math.ceil(totalTickets / LIMITE_TICKETS))
  const temRecorteTickets = Boolean(q || avaliacao || periodo)

  const chatsFiltrados = (chats.data?.results ?? []).filter((c) => {
    if (avaliacao === 'sim') return c.rating !== null
    if (avaliacao === 'nao') return c.rating === null && !c.ticket_id
    return true
  })
  const totalChats = chats.data?.count ?? 0
  const pendentesTotal = (ticketsPendentes?.length ?? 0) + (chatsPendentes?.length ?? 0)

  function limparTudo() {
    setBusca('')
    definir({ q: undefined, avaliacao: undefined, periodo: undefined })
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-titulo-lg font-forte tracking-display">Histórico</h1>
        <p className="mt-1 text-pequeno text-tinta-secundaria">
          Chamados resolvidos ou fechados e conversas encerradas, com as avaliações que você deu.
        </p>
      </header>

      {pendentesTotal > 0 && (
        <Card className="border-alerta/40 bg-alerta-suave/30" aria-labelledby="pendentes-titulo">
          <CardHeader>
            <CardTitle id="pendentes-titulo">
              {pendentesTotal === 1 ? 'Uma avaliação pendente' : `${pendentesTotal} avaliações pendentes`}
            </CardTitle>
            <CardDescription>Sua nota vai para quem cuidou do atendimento — e, no chat, é o que libera a próxima conversa.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-divisoria">
              {(chatsPendentes ?? []).map((c) => (
                <li key={`chat-${c.id}`} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-pequeno font-medio">
                      Chat {c.agent_name ? `com ${primeiroNome(c.agent_name)}` : 'sem atendimento'}
                    </span>
                    <span className="block text-legenda text-tinta-secundaria">encerrado {relativo(c.closed_at, agora)}</span>
                  </span>
                  <Link to="/portal/chat" className={buttonVariants({ size: 'sm' })}>
                    Avaliar chat
                  </Link>
                </li>
              ))}
              {(ticketsPendentes ?? []).map((t) => (
                <li key={`ticket-${t.ticket_id}`} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-pequeno font-medio">
                      <span className="fonte-mono text-acento">{t.reference}</span> · {t.subject}
                    </span>
                    <span className="block text-legenda text-tinta-secundaria">chamado resolvido</span>
                  </span>
                  <Link to={`/portal/tickets/${t.ticket_id}`} className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                    Avaliar
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <section aria-label="Resumo" className="grid grid-cols-3 gap-2 sm:gap-3 md:gap-4">
        <CartaoNumero rotulo="Chamados encerrados" valor={contagens.tickets} icone={IconTicket} />
        <CartaoNumero rotulo="Conversas encerradas" valor={contagens.chats} icone={IconMessageCircle} />
        <CartaoNumero
          rotulo="Chamados avaliados"
          valor={contagens.ticketsAvaliados}
          icone={IconStar}
          detalhe={contagens.tickets ? `de ${contagens.tickets} encerrado${contagens.tickets === 1 ? '' : 's'}` : undefined}
        />
      </section>

      <Tabs value={aba} onValueChange={(v) => definir({ aba: v === 'chats' ? 'chats' : undefined })}>
        <TabsList aria-label="Tipo de atendimento">
          <TabsTrigger value="tickets">
            Tickets
            <Badge variant={aba === 'tickets' ? 'acento' : 'neutro'} className="px-1.5 py-0 text-micro">
              {contagens.tickets ?? '…'}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="chats">
            Chats
            <Badge variant={aba === 'chats' ? 'acento' : 'neutro'} className="px-1.5 py-0 text-micro">
              {contagens.chats ?? '…'}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          {aba === 'tickets' ? (
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-secundaria" aria-hidden="true" />
              <Input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por número, assunto ou nº do pedido"
                aria-label="Buscar no histórico"
                className="pl-9"
              />
            </div>
          ) : (
            <p className="self-center text-pequeno text-tinta-secundaria">
              {!chats.data
                ? 'Carregando…'
                : avaliacao
                  ? totalChats > chats.data.results.length
                    ? `${chatsFiltrados.length} de ${chats.data.results.length} carregadas · o filtro olha só as já carregadas (${totalChats} no total)`
                    : `${chatsFiltrados.length} de ${totalChats} conversa${totalChats === 1 ? '' : 's'}`
                  : `${totalChats} conversa${totalChats === 1 ? '' : 's'}`}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="h-avaliacao">Avaliação</Label>
            <Select id="h-avaliacao" value={avaliacao} onChange={(e) => definir({ avaliacao: e.target.value || undefined })} className="sm:w-44">
              {AVALIACOES.map((a) => (
                <option key={a.valor} value={a.valor}>
                  {a.rotulo}
                </option>
              ))}
            </Select>
          </div>
          {aba === 'tickets' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="h-periodo">Período</Label>
              <Select id="h-periodo" value={periodo} onChange={(e) => definir({ periodo: e.target.value || undefined })} className="sm:w-44">
                {PERIODOS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {aba === 'tickets' && temRecorteTickets && (
          <div className="mt-2 flex items-center gap-2 text-pequeno text-tinta-secundaria">
            <span>
              {tickets.data ? `${totalTickets} resultado${totalTickets === 1 ? '' : 's'}` : 'Buscando…'}
              {q && (
                <>
                  {' '}
                  para <strong className="text-tinta">“{q}”</strong>
                </>
              )}
            </span>
            <Button variant="link" size="sm" onClick={limparTudo}>
              <IconX /> Limpar
            </Button>
          </div>
        )}

        <TabsContent value="tickets" className="mt-4">
          <section aria-live="polite" aria-busy={tickets.isFetching} className={cn('flex flex-col gap-2 transition-opacity', tickets.isFetching && tickets.data && 'opacity-70')}>
            {tickets.isError ? (
              <Alert
                variant="destructive"
                titulo="Não foi possível carregar o histórico"
                acao={
                  <Button size="sm" variant="secondary" onClick={() => tickets.refetch()}>
                    Tentar de novo
                  </Button>
                }
              >
                {tickets.error instanceof ApiError ? `Erro ${tickets.error.status}.` : 'Verifique sua conexão.'}
              </Alert>
            ) : tickets.isLoading ? (
              [0, 1, 2].map((i) => <EsqueletoCartaoTicket key={i} />)
            ) : totalTickets === 0 ? (
              temRecorteTickets ? (
                <EstadoVazio
                  icone={IconZoomCancel}
                  titulo="Nenhum chamado encontrado"
                  descricao="Tente outro termo ou limpe os filtros."
                  acao={
                    <Button variant="secondary" size="sm" onClick={limparTudo}>
                      Limpar busca e filtros
                    </Button>
                  }
                />
              ) : (
                <EstadoVazio
                  icone={IconHistory}
                  titulo="Nenhum chamado encerrado ainda"
                  descricao="Quando um chamado for resolvido ou fechado, ele aparece aqui com a avaliação que você der."
                  acao={
                    <Link to="/portal/tickets" className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                      Ver chamados em aberto
                    </Link>
                  }
                />
              )
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {tickets.data!.results.map((t) => (
                    <LinhaTicket key={t.id} ticket={t} pendente={idsPendentes.has(t.id)} />
                  ))}
                </ul>
                {totalTickets > LIMITE_TICKETS && (
                  <footer className="flex items-center justify-between gap-3 pt-2 text-pequeno text-tinta-secundaria">
                    <span>
                      {(pagina - 1) * LIMITE_TICKETS + 1}–{Math.min(pagina * LIMITE_TICKETS, totalTickets)} de {totalTickets}
                    </span>
                    <span className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pagina <= 1}
                        onClick={() => definir({ pagina: pagina - 1 > 1 ? String(pagina - 1) : undefined }, { manterPagina: true })}
                      >
                        <IconChevronLeft /> Anterior
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pagina >= ultimaPagina}
                        onClick={() => definir({ pagina: String(pagina + 1) }, { manterPagina: true })}
                      >
                        Próxima <IconChevronRight />
                      </Button>
                    </span>
                  </footer>
                )}
              </>
            )}
          </section>
        </TabsContent>

        <TabsContent value="chats" className="mt-4">
          <section aria-live="polite" aria-busy={chats.isFetching} className={cn('flex flex-col gap-2 transition-opacity', chats.isFetching && chats.data && 'opacity-70')}>
            {chats.isError ? (
              <Alert
                variant="destructive"
                titulo="Não foi possível carregar as conversas"
                acao={
                  <Button size="sm" variant="secondary" onClick={() => chats.refetch()}>
                    Tentar de novo
                  </Button>
                }
              >
                {chats.error instanceof ApiError ? `Erro ${chats.error.status}.` : 'Verifique sua conexão.'}
              </Alert>
            ) : chats.isLoading ? (
              [0, 1, 2].map((i) => <EsqueletoCartaoTicket key={i} />)
            ) : totalChats === 0 ? (
              <EstadoVazio
                icone={IconMessageCircle}
                titulo="Nenhuma conversa encerrada"
                descricao="As conversas por chat que terminarem ficam aqui, com as notas que você deu."
                acao={
                  <Link to="/portal/chat" className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                    Ir para o chat
                  </Link>
                }
              />
            ) : chatsFiltrados.length === 0 ? (
              <EstadoVazio
                icone={IconZoomCancel}
                titulo={avaliacao === 'sim' ? 'Nenhuma conversa avaliada' : 'Nenhuma conversa sem avaliação'}
                descricao="O filtro olha as conversas já carregadas."
                acao={
                  <Button variant="secondary" size="sm" onClick={() => definir({ avaliacao: undefined })}>
                    Mostrar todas
                  </Button>
                }
              />
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {chatsFiltrados.map((c) => (
                    <LinhaChat key={c.id} chat={c} max={maxChat} agoraMs={agora} />
                  ))}
                </ul>
                {chats.data!.next && (
                  <div className="pt-2 text-center">
                    <Button variant="outline" size="sm" disabled={chats.isFetching} onClick={() => setLimiteChats((l) => l + PASSO_CHATS)}>
                      {chats.isFetching ? 'Carregando…' : `Carregar mais conversas (${totalChats - chats.data!.results.length} restantes)`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}
