import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { IconBook, IconMessagePlus, IconPlus, IconSearch, IconX, IconZoomCancel } from '@tabler/icons-react'
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

/**
 * O cartão inteiro é o link — por isso sem a seta "→" que havia no rodapé:
 * ela repetia por grafismo o que o cartão já é, e numa grade de nove
 * cartões virava nove setas.
 */
function CartaoArtigo({ artigo }: { artigo: ArtigoResumo }) {
  return (
    <Link
      to={`/portal/ajuda/${artigo.id}`}
      className="group flex flex-col gap-2 rounded-md bg-superficie p-5 transition-colors hover:bg-navegacao-hover"
    >
      {artigo.category && (
        <Badge variant="neutro" className="w-fit">
          {artigo.category}
        </Badge>
      )}
      <h3 className="text-titulo font-forte leading-justa text-tinta">{artigo.title}</h3>
      {artigo.excerpt && <p className="line-clamp-3 text-corpo text-tinta-secundaria">{artigo.excerpt}</p>}
      {(artigo.wp_modified_at || artigo.helpful_count > 0) && (
        <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-legenda text-tinta-secundaria">
          {artigo.wp_modified_at && <span>Atualizado em {dataCurta(artigo.wp_modified_at)}</span>}
          {artigo.helpful_count > 0 && <span>{artigo.helpful_count} acharam útil</span>}
        </span>
      )}
    </Link>
  )
}

/** Filtro de categoria: pílula com a linha de controle; a escolhida é o
 *  acento cheio (o único do produto), que é o estado "ligado". */
const CHIP =
  'inline-flex h-8 items-center gap-2 rounded-total border border-borda-controle px-3.5 text-pequeno font-medio text-tinta transition-colors hover:bg-navegacao-hover'
const CHIP_ATIVO = 'border-primario bg-primario text-primario-sobre hover:bg-primario-hover'

function EsqueletoCartao() {
  return (
    <div className="flex flex-col gap-3 rounded-md bg-superficie p-5">
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
      {/* ---------------- título e busca, direto no plano ----------------
          Sem o cartão central com ícone que havia aqui: o título e a busca
          já são o destaque, e a moldura só empurrava os artigos para baixo. */}
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-titulo-lg font-forte">Central de Ajuda</h1>
          <p className="mt-1 text-corpo text-tinta-secundaria">
            Tutoriais e respostas prontas. Antes de abrir um ticket, veja se a resposta já está aqui.
          </p>
        </div>
        <div className="relative w-full max-w-2xl">
          <IconSearch className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-tinta-secundaria" stroke={1.75} aria-hidden="true" />
          <Input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por assunto, erro ou palavra-chave"
            aria-label="Buscar na Central de Ajuda"
            className="h-11 rounded-total pl-11 pr-4 text-corpo-lg"
          />
        </div>
      </header>

      {/* ---------------- categorias ---------------- */}
      {(categorias.data?.length ?? 0) > 0 && (
        <section aria-label="Categorias" className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => definir({ categoria: undefined })}
            aria-pressed={!categoria}
            className={cn(CHIP, !categoria && CHIP_ATIVO)}
          >
            Todos
          </button>
          {categorias.data!.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => definir({ categoria: c.name === categoria ? undefined : c.name })}
              aria-pressed={c.name === categoria}
              className={cn(CHIP, c.name === categoria && CHIP_ATIVO)}
            >
              {c.name}
              <span className={cn('text-legenda', c.name === categoria ? 'opacity-80' : 'text-tinta-secundaria')}>{c.count}</span>
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
                descricao="Enquanto a Central de Ajuda não tem conteúdo, fale com a gente: o suporte responde por ticket ou chat."
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
                    ? `Nenhum artigo fala sobre “${q}”. Tente outra palavra, ou abra um ticket e a gente responde.`
                    : 'Nenhum artigo nesta categoria ainda. Veja as outras categorias ou abra um ticket.'
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
          Conte o que você tentou. Assim o suporte já começa de onde você parou.
        </Alert>
      )}
    </div>
  )
}
