import { Link, useParams } from 'react-router-dom'
import { IconArrowLeft, IconExternalLink, IconPlus, IconThumbDown, IconThumbUp } from '@tabler/icons-react'
import { ApiError } from '@/api/client'
import { useArtigo, useAvaliarArtigo } from '../api/ajuda'
import { cn } from '../lib/cn'
import { dataCurta } from '../lib/formato'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button, buttonVariants } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { ESTILO_ARTIGO } from './estiloArtigo'


function Esqueleto() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando artigo">
      <Link to="/portal/ajuda" className="inline-flex w-fit items-center gap-1 text-pequeno text-tinta-secundaria hover:text-tinta">
        <IconArrowLeft className="size-4" aria-hidden="true" /> Central de Ajuda
      </Link>
      <Skeleton className="h-8 w-2/3" />
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    </div>
  )
}

export function PaginaArtigo() {
  const { id } = useParams<{ id: string }>()
  const artigoId = Number(id)
  const { data: artigo, isLoading, isError, error, refetch, isFetching } = useArtigo(artigoId)
  const avaliar = useAvaliarArtigo(artigoId)

  if (isLoading) return <Esqueleto />

  if (isError || !artigo) {
    const naoExiste = error instanceof ApiError && error.status === 404
    return (
      <div className="flex flex-col gap-4">
        <Link to="/portal/ajuda" className="inline-flex w-fit items-center gap-1 text-pequeno text-tinta-secundaria hover:text-tinta">
          <IconArrowLeft className="size-4" aria-hidden="true" /> Central de Ajuda
        </Link>
        <Alert
          variant="destructive"
          titulo={naoExiste ? 'Este artigo não existe mais' : 'Não foi possível carregar o artigo'}
          acao={
            naoExiste ? undefined : (
              <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
                Tentar de novo
              </Button>
            )
          }
        >
          {naoExiste ? 'Ele pode ter sido despublicado. Busque de novo na Central de Ajuda.' : 'Tente de novo em instantes.'}
        </Alert>
      </div>
    )
  }

  const jaVotou = artigo.my_feedback !== null

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link to="/portal/ajuda" className="inline-flex w-fit items-center gap-1 text-pequeno text-tinta-secundaria hover:text-tinta">
        <IconArrowLeft className="size-4" aria-hidden="true" /> Central de Ajuda
      </Link>

      <header className="flex flex-col gap-2">
        {artigo.category && (
          <Link to={`/portal/ajuda?categoria=${encodeURIComponent(artigo.category)}`} className="w-fit rounded-total">
            <Badge variant="neutro">{artigo.category}</Badge>
          </Link>
        )}
        <h1 className="text-titulo-lg font-forte leading-justa">{artigo.title}</h1>
        <p className="text-legenda text-tinta-secundaria">
          {artigo.wp_modified_at ? `Atualizado em ${dataCurta(artigo.wp_modified_at)}` : null}
          {artigo.tags.length > 0 && <> · {artigo.tags.join(' · ')}</>}
        </p>
      </header>

      <Card>
        <CardContent className="p-6 md:p-8">
          {artigo.body_html ? (
            // O HTML vem do WordPress e é higienizado NO SERVIDOR (nh3, em
            // `ArticleDetailSerializer.get_body_html`): script, `on*=` e
            // `javascript:` já não chegam aqui. Sanitizar de novo no
            // navegador seria uma segunda régua para discordar da primeira.
            <div className={ESTILO_ARTIGO} dangerouslySetInnerHTML={{ __html: artigo.body_html }} />
          ) : (
            <p className="text-pequeno text-tinta-secundaria">
              Este artigo ainda não tem conteúdo publicado.{' '}
              <a href={artigo.wp_url} target="_blank" rel="noreferrer" className="text-acento underline">
                Ver no site
              </a>
              .
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---------------- isso ajudou? ---------------- */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div>
            <p className="text-corpo font-medio text-tinta">{jaVotou ? 'Obrigado pelo retorno!' : 'Este artigo ajudou?'}</p>
            <p className="text-legenda text-tinta-secundaria">
              {artigo.helpful_count + artigo.not_helpful_count > 0
                ? `${artigo.helpful_count} de ${artigo.helpful_count + artigo.not_helpful_count} acharam útil`
                : 'Seu voto ajuda a melhorar a Central de Ajuda.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={artigo.my_feedback === true ? 'default' : 'outline'}
              size="sm"
              disabled={avaliar.isPending}
              aria-pressed={artigo.my_feedback === true}
              onClick={() =>
                avaliar.mutate(true, { onError: () => toast.error('Não foi possível registrar seu voto.') })
              }
            >
              <IconThumbUp /> Sim
            </Button>
            <Button
              variant={artigo.my_feedback === false ? 'default' : 'outline'}
              size="sm"
              disabled={avaliar.isPending}
              aria-pressed={artigo.my_feedback === false}
              onClick={() =>
                avaliar.mutate(false, { onError: () => toast.error('Não foi possível registrar seu voto.') })
              }
            >
              <IconThumbDown /> Não
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* quem votou "não" precisa de saída, não de um obrigado */}
      {artigo.my_feedback === false && (
        <Alert
          variant="info"
          titulo="Vamos resolver isso com você"
          acao={
            <Link to="/portal/tickets/novo" className={buttonVariants({ size: 'sm' })}>
              <IconPlus /> Abrir ticket
            </Link>
          }
        >
          Conte o que faltou no artigo. O suporte responde no seu caso.
        </Alert>
      )}

      {artigo.related.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-titulo font-forte text-tinta">Artigos relacionados</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {artigo.related.map((r) => (
              <Link
                key={r.id}
                to={`/portal/ajuda/${r.id}`}
                className="rounded-md bg-superficie p-4 text-corpo font-medio text-tinta transition-colors hover:bg-[var(--fundo-hover)]"
              >
                {r.title}
              </Link>
            ))}
          </div>
        </section>
      )}

      {artigo.wp_url && (
        <a
          href={artigo.wp_url}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-fit')}
        >
          <IconExternalLink /> Ver no site
        </a>
      )}
    </div>
  )
}
