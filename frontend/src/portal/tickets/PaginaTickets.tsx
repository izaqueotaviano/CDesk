import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Search, SearchX, SlidersHorizontal, Ticket, X } from 'lucide-react'
import { ApiError } from '@/api/client'
import {
  ABAS,
  ABA_PADRAO,
  ORDENS,
  useCategoriasCliente,
  useContagemAbas,
  useTicketsCliente,
  type AbaTickets,
  type OrdemTickets,
  type ParamsTickets,
} from '../api/tickets'
import { cn } from '../lib/cn'
import { ROTULO_PRIORIDADE, useAgora } from '../lib/formato'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button, buttonVariants } from '../ui/button'
import { EstadoVazio } from '../ui/estado-vazio'
import { Input, Label, Select } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { CartaoTicket, EsqueletoCartaoTicket } from './componentes'

const LIMITE = 10
const PRIORIDADES = ['low', 'normal', 'high', 'urgent'] as const

/**
 * Lista de tickets do cliente. Tudo que muda a lista mora na URL (?aba, ?q,
 * filtros, ordem, página): F5 e link compartilhado voltam ao mesmo lugar.
 * As abas são recortes nomeados do servidor — contador e lista nunca
 * discordam porque vêm da mesma consulta.
 */
export function PaginaTickets() {
  const [params, setParams] = useSearchParams()
  const agora = useAgora()

  const abaParam = params.get('aba')
  const aba: AbaTickets = ABAS.some((a) => a.id === abaParam) ? (abaParam as AbaTickets) : ABA_PADRAO
  const ordemParam = params.get('ordem')
  const ordem: OrdemTickets = ORDENS.some((o) => o.valor === ordemParam) ? (ordemParam as OrdemTickets) : '-criado'
  const pagina = Math.max(1, Number(params.get('pagina') ?? 1) || 1)
  const q = params.get('q') ?? ''
  const prioridade = params.get('prioridade') ?? ''
  const categoria = params.get('categoria') ?? ''
  const desde = params.get('desde') ?? ''
  const ate = params.get('ate') ?? ''

  const consulta: ParamsTickets = {
    aba,
    q: q || undefined,
    prioridade: prioridade || undefined,
    categoria: categoria || undefined,
    desde: desde || undefined,
    ate: ate || undefined,
    ordem,
    limit: LIMITE,
    offset: (pagina - 1) * LIMITE,
  }

  const lista = useTicketsCliente(consulta)
  const contagens = useContagemAbas()
  const { data: categorias } = useCategoriasCliente()

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

  const [mostrarFiltros, setMostrarFiltros] = useState(false)
  const filtrosAtivos = [prioridade, categoria, desde, ate].filter(Boolean).length
  const temRecorte = filtrosAtivos > 0 || q.length > 0

  function limparTudo() {
    setBusca('')
    definir({ q: undefined, prioridade: undefined, categoria: undefined, desde: undefined, ate: undefined })
  }

  const definicao = ABAS.find((a) => a.id === aba) ?? ABAS[0]
  const total = lista.data?.count ?? 0
  const inicio = total === 0 ? 0 : consulta.offset + 1
  const fim = Math.min(consulta.offset + LIMITE, total)
  const ultimaPagina = Math.max(1, Math.ceil(total / LIMITE))

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-titulo-lg font-forte tracking-display">Tickets</h1>
          <p className="mt-1 text-pequeno text-tinta-secundaria">Seus chamados com o suporte, do mais urgente ao já resolvido.</p>
        </div>
        <Link to="/portal/tickets/novo" className={buttonVariants()}>
          <Plus /> Abrir ticket
        </Link>
      </header>

      <Tabs value={aba} onValueChange={(v) => definir({ aba: v })}>
        <TabsList aria-label="Situação do chamado" className="w-full sm:w-auto">
          {ABAS.map((a) => {
            const n = contagens[a.id]
            const realce = a.destaque && (n ?? 0) > 0
            return (
              <TabsTrigger
                key={a.id}
                value={a.id}
                // laranja só quando há algo esperando a pessoa — com zero, é uma aba como as outras
                className={cn(realce && 'data-[state=active]:bg-alerta-suave data-[state=active]:text-alerta')}
              >
                {a.rotulo}
                {n === undefined ? (
                  <Skeleton className="h-4 w-5 rounded-total" />
                ) : (
                  <Badge variant={realce ? 'alerta' : 'neutro'} className="px-1.5 py-0 text-micro" aria-label={`${n} chamados`}>
                    {n}
                  </Badge>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-secundaria" aria-hidden="true" />
            <Input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por número, assunto ou nº do pedido"
              aria-label="Buscar tickets"
              className="pl-9"
            />
          </div>
          <Button
            variant="secondary"
            className="md:hidden"
            onClick={() => setMostrarFiltros((v) => !v)}
            aria-expanded={mostrarFiltros}
            aria-controls="filtros-tickets"
          >
            <SlidersHorizontal /> Filtros
            {filtrosAtivos > 0 && <Badge variant="acento" className="px-1.5 py-0 text-micro">{filtrosAtivos}</Badge>}
          </Button>
        </div>

        <div id="filtros-tickets" className={cn('grid gap-3 sm:grid-cols-2 md:grid-cols-5', !mostrarFiltros && 'hidden md:grid')}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-prioridade">Prioridade</Label>
            <Select id="f-prioridade" value={prioridade} onChange={(e) => definir({ prioridade: e.target.value || undefined })}>
              <option value="">Todas</option>
              {PRIORIDADES.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PRIORIDADE[p]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-categoria">Categoria</Label>
            <Select id="f-categoria" value={categoria} onChange={(e) => definir({ categoria: e.target.value || undefined })}>
              <option value="">Todas</option>
              {(categorias ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-desde">Aberto desde</Label>
            <Input id="f-desde" type="date" value={desde} max={ate || undefined} onChange={(e) => definir({ desde: e.target.value || undefined })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-ate">Aberto até</Label>
            <Input id="f-ate" type="date" value={ate} min={desde || undefined} onChange={(e) => definir({ ate: e.target.value || undefined })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-ordem">Ordenar por</Label>
            <Select id="f-ordem" value={ordem} onChange={(e) => definir({ ordem: e.target.value }, { manterPagina: false })}>
              {ORDENS.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {temRecorte && (
          <div className="flex items-center gap-2 text-pequeno text-tinta-secundaria">
            <span>
              {lista.data ? `${total} resultado${total === 1 ? '' : 's'}` : 'Buscando…'}
              {q && (
                <>
                  {' '}
                  para <strong className="text-tinta">“{q}”</strong>
                </>
              )}
            </span>
            <Button variant="link" size="sm" onClick={limparTudo}>
              <X /> Limpar
            </Button>
          </div>
        )}
      </div>

      <section aria-live="polite" aria-busy={lista.isFetching} className={cn('flex flex-col gap-2 transition-opacity', lista.isFetching && lista.data && 'opacity-70')}>
        {lista.isError ? (
          <Alert
            variant="destructive"
            titulo="Não foi possível carregar seus tickets"
            acao={
              <Button size="sm" variant="secondary" onClick={() => lista.refetch()}>
                Tentar de novo
              </Button>
            }
          >
            {lista.error instanceof ApiError ? `Erro ${lista.error.status}.` : 'Verifique sua conexão.'}
          </Alert>
        ) : lista.isLoading ? (
          [0, 1, 2, 3, 4].map((i) => <EsqueletoCartaoTicket key={i} />)
        ) : total === 0 ? (
          temRecorte ? (
            <EstadoVazio
              icone={SearchX}
              titulo="Nenhum ticket encontrado"
              descricao="Tente outro termo ou limpe os filtros. A busca olha o número do chamado, o assunto e o nº do pedido."
              acao={
                <Button variant="secondary" size="sm" onClick={limparTudo}>
                  Limpar busca e filtros
                </Button>
              }
            />
          ) : (
            <EstadoVazio
              icone={Ticket}
              titulo={definicao.vazio.titulo}
              descricao={definicao.vazio.descricao}
              acao={
                aba === 'aguardando-suporte' || aba === 'em-andamento' ? (
                  <Link to="/portal/tickets/novo" className={buttonVariants({ size: 'sm' })}>
                    <Plus /> Abrir ticket
                  </Link>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            {lista.data!.results.map((t) => (
              <CartaoTicket key={t.id} ticket={t} agoraMs={agora} />
            ))}
            {total > LIMITE && (
              <footer className="flex items-center justify-between gap-3 pt-2 text-pequeno text-tinta-secundaria">
                <span>
                  {inicio}–{fim} de {total}
                </span>
                <span className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagina <= 1}
                    onClick={() => definir({ pagina: pagina - 1 > 1 ? String(pagina - 1) : undefined }, { manterPagina: true })}
                  >
                    <ChevronLeft /> Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagina >= ultimaPagina}
                    onClick={() => definir({ pagina: String(pagina + 1) }, { manterPagina: true })}
                  >
                    Próxima <ChevronRight />
                  </Button>
                </span>
              </footer>
            )}
          </>
        )}
      </section>
    </div>
  )
}
