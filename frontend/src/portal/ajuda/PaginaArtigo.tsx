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

/**
 * Estilo do HTML que vem do WordPress. Sem plugin de tipografia no projeto:
 * as regras moram aqui, em cima dos tokens do design system, para o artigo
 * não herdar o "sem estilo" do navegador nem escapar da paleta.
 */
const ESTILO_ARTIGO = [
  'text-corpo leading-relaxed text-tinta',
  '[&_h2]:mt-8 [&_h2]:text-titulo-sm [&_h2]:font-forte [&_h2]:text-tinta',
  '[&_h3]:mt-6 [&_h3]:text-corpo-lg [&_h3]:font-forte [&_h3]:text-tinta',
  '[&_p]:mt-4',
  '[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mt-1.5',
  '[&_a]:text-acento [&_a]:underline [&_a]:underline-offset-2',
  '[&_strong]:font-forte',
  '[&_img]:mt-4 [&_img]:rounded-lg [&_img]:border [&_img]:',
  '[&_figure]:mt-4 [&_figcaption]:mt-1.5 [&_figcaption]:text-legenda [&_figcaption]:text-tinta-secundaria',
  '[&_blockquote]:mt-4 [&_blockquote]:border-l-2 [&_blockquote]:border-acento [&_blockquote]:pl-4 [&_blockquote]:text-tinta-secundaria',
  '[&_code]:rounded [&_code]:bg-navegacao [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-pequeno [&_code]:fonte-mono',
  '[&_pre]:mt-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-navegacao [&_pre]:p-4 [&_pre]:text-pequeno',
  '[&_table]:mt-4 [&_table]:w-full [&_table]:text-pequeno [&_th]:border-b [&_th]: [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]: [&_td]:p-2',
  '[&_hr]:my-6 [&_hr]:',
].join(' ')

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
          <Link to={`/portal/ajuda?categoria=${encodeURIComponent(artigo.category)}`} className="w-fit">
            <Badge variant="acento">{artigo.category}</Badge>
          </Link>
        )}
        <h1 className="text-titulo-lg font-forte leading-justa tracking-display">{artigo.title}</h1>
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
          Conte o que faltou no artigo — o suporte responde no seu caso.
        </Alert>
      )}

      {artigo.related.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-corpo font-forte text-tinta">Artigos relacionados</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {artigo.related.map((r) => (
              <Link
                key={r.id}
                to={`/portal/ajuda/${r.id}`}
                className="rounded-xl  bg-superficie p-4 text-pequeno font-medio text-tinta transition-colors hover:border-acento hover:text-acento"
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
