import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { IconArrowRight, IconBook, IconLifebuoy, IconMessagePlus, IconPlus, IconSearch, IconX, IconZoomCancel } from '@tabler/icons-react'
import { ApiError } from '@/api/client'
import { useArtigos, useCategoriasAjuda, type ArtigoResumo } from '../api/ajuda'
import { cn } from '../lib/cn'
import { dataCurta } from '../lib/formato'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button, buttonVariants } from '../ui/button'
import { Card } from '../ui/card'
import { EstadoVazio } from '../ui/estado-vazio'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'

function CartaoArtigo({ artigo }: { artigo: ArtigoResumo }) {
  return (
    <Link
      to={`/portal/ajuda/${artigo.id}`}
      className="group flex flex-col gap-2 rounded-xl border border-divisoria bg-superficie p-5 transition-[border-color] hover:border-borda-controle"
    >
      {artigo.category && (
        <Badge variant="acento" className="w-fit">
          {artigo.category}
        </Badge>
      )}
      <h3 className="text-corpo-lg font-forte leading-justa text-tinta group-hover:text-acento">{artigo.title}</h3>
      {artigo.excerpt && <p className="line-clamp-3 text-pequeno leading-normal text-tinta-secundaria">{artigo.excerpt}</p>}
      <span className="mt-auto flex items-center gap-3 pt-1 text-legenda text-tinta-terciaria">
        {artigo.wp_modified_at && <span>atualizado {dataCurta(artigo.wp_modified_at)}</span>}
        {artigo.helpful_count > 0 && <span>{artigo.helpful_count} acharam útil</span>}
        <IconArrowRight className="ml-auto size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  )
}

function EsqueletoCartao() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-divisoria bg-superficie p-5">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

/**
 * Central de Ajuda: busca em destaque, navegação por categoria e os artigos
 * em cards. O acervo é o do WordPress (espelhado pela sincronização) — esta
 * tela nunca cria conteúdo, só lê.
 *
 * Busca e categoria moram na URL: um resultado de busca é link compartilhável
 * ("olha esse artigo aqui") e sobrevive ao F5.
 */
export function PaginaAjuda() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const categoria = params.get('categoria') ?? ''

  const artigos = useArtigos({ q: q || undefined, categoria: categoria || undefined })
  const categorias = useCategoriasAjuda()

  const definir = useCallback(
    (mudancas: Record<string, string | undefined>) => {
      setParams(
        (atual) => {
          const novo = new URLSearchParams(atual)
          for (const [k, v] of Object.entries(mudancas)) {
            if (v) novo.set(k, v)
            else novo.delete(k)
          }
          return novo
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // digitar não recarrega a cada tecla: a URL (e a consulta) espera 300 ms
  const [busca, setBusca] = useState(q)
  useEffect(() => {
    const alvo = busca.trim()
    if (alvo === q) return
    const h = setTimeout(() => definir({ q: alvo || undefined }), 300)
    return () => clearTimeout(h)
  }, [busca, q, definir])

  const temRecorte = Boolean(q || categoria)
  const total = artigos.data?.length ?? 0
  const acervoVazio = !temRecorte && !artigos.isLoading && total === 0

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------- busca em destaque ---------------- */}
      <section className="flex flex-col items-center gap-4 rounded-xl border border-divisoria bg-superficie px-4 py-8 text-center md:px-8 md:py-10">
        <span className="grid size-12 place-items-center rounded-total bg-acento-suave text-acento">
          <IconLifebuoy className="size-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-titulo-lg font-forte tracking-display">Central de Ajuda</h1>
          <p className="mt-1 text-pequeno text-tinta-secundaria">
            Tutoriais e respostas prontas — antes de abrir um ticket, veja se já tem a resposta aqui.
          </p>
        </div>
        <div className="relative w-full max-w-xl">
          <IconSearch className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-tinta-secundaria" aria-hidden="true" />
          <Input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por assunto, erro ou palavra-chave"
            aria-label="Buscar na Central de Ajuda"
            className="h-12 pl-12 pr-4 text-corpo-lg"
          />
        </div>
      </section>

      {/* ---------------- categorias ---------------- */}
      {(categorias.data?.length ?? 0) > 0 && (
        <section aria-label="Categorias" className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => definir({ categoria: undefined })}
            aria-pressed={!categoria}
            className={cn(
              'h-7 rounded-md border border-divisoria bg-superficie px-3 text-pequeno font-medio text-tinta-secundaria transition-colors hover:border-acento hover:text-acento',
              !categoria && 'border-acento bg-acento-suave text-acento',
            )}
          >
            Todos
          </button>
          {categorias.data!.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => definir({ categoria: c.name === categoria ? undefined : c.name })}
              aria-pressed={c.name === categoria}
              className={cn(
                'inline-flex items-center gap-2 h-7 rounded-md border border-divisoria bg-superficie px-3 text-pequeno font-medio text-tinta-secundaria transition-colors hover:border-acento hover:text-acento',
                c.name === categoria && 'border-acento bg-acento-suave text-acento',
              )}
            >
              {c.name}
              <span className="text-legenda text-tinta-terciaria">{c.count}</span>
            </button>
          ))}
        </section>
      )}

      {/* ---------------- resultados ---------------- */}
      {temRecorte && !artigos.isLoading && (
        <div className="flex items-center gap-2 text-pequeno text-tinta-secundaria">
          <span>
            {total} resultado{total === 1 ? '' : 's'}
            {q && (
              <>
                {' '}
                para <strong className="text-tinta">“{q}”</strong>
              </>
            )}
            {categoria && (
              <>
                {' '}
                em <strong className="text-tinta">{categoria}</strong>
              </>
            )}
          </span>
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setBusca('')
              definir({ q: undefined, categoria: undefined })
            }}
          >
            <IconX /> Limpar
          </Button>
        </div>
      )}

      <section aria-live="polite" aria-busy={artigos.isFetching}>
        {artigos.isError ? (
          <Alert
            variant="destructive"
            titulo="Não foi possível carregar os artigos"
            acao={
              <Button size="sm" variant="secondary" onClick={() => artigos.refetch()}>
                Tentar de novo
              </Button>
            }
          >
            {artigos.error instanceof ApiError ? `Erro ${artigos.error.status}.` : 'Verifique sua conexão.'}
          </Alert>
        ) : artigos.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <EsqueletoCartao key={i} />
            ))}
          </div>
        ) : total === 0 ? (
          <Card>
            {acervoVazio ? (
              <EstadoVazio
                icone={IconBook}
                titulo="Nenhum artigo publicado ainda"
                descricao="Enquanto a Central de Ajuda não tem conteúdo, fale com a gente — o suporte responde por ticket ou chat."
                acao={
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Link to="/portal/tickets/novo" className={buttonVariants({ size: 'sm' })}>
                      <IconPlus /> Abrir ticket
                    </Link>
                    <Link to="/portal/chat" className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                      <IconMessagePlus /> Iniciar chat
                    </Link>
                  </div>
                }
              />
            ) : (
              <EstadoVazio
                icone={IconZoomCancel}
                titulo="Nada encontrado"
                descricao={
                  q
                    ? `Nenhum artigo fala sobre “${q}”. Tente outra palavra — ou abra um ticket e a gente responde.`
                    : 'Nenhum artigo nesta categoria.'
                }
                acao={
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setBusca('')
                        definir({ q: undefined, categoria: undefined })
                      }}
                    >
                      Limpar busca
                    </Button>
                    <Link to="/portal/tickets/novo" className={buttonVariants({ size: 'sm' })}>
                      <IconPlus /> Abrir ticket
                    </Link>
                  </div>
                }
              />
            )}
          </Card>
        ) : (
          <div className={cn('grid gap-4 md:grid-cols-2 lg:grid-cols-3', artigos.isFetching && 'opacity-70')}>
            {artigos.data!.map((a) => (
              <CartaoArtigo key={a.id} artigo={a} />
            ))}
          </div>
        )}
      </section>

      {total > 0 && (
        <Alert
          variant="info"
          titulo="Não achou o que precisava?"
          acao={
            <Link to="/portal/tickets/novo" className={buttonVariants({ size: 'sm' })}>
              <IconPlus /> Abrir ticket
            </Link>
          }
        >
          Conte o que você tentou — assim o suporte já começa de onde você parou.
        </Alert>
      )}
    </div>
  )
}
