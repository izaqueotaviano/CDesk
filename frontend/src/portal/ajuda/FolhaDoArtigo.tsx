import * as DialogPrimitive from '@radix-ui/react-dialog'
import { IconExternalLink, IconX } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import { useArtigo } from '../api/ajuda'
import { cn } from '../lib/cn'
import { buttonVariants } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { ESTILO_ARTIGO } from './estiloArtigo'

/**
 * Um artigo da Central de Ajuda numa folha lateral, POR CIMA do formulário.
 *
 * É o que deixa ler a sugestão sem sair da abertura do chamado: o
 * formulário continua montado embaixo, com o que foi escrito e os anexos
 * escolhidos (anexo não cabe no rascunho local — sair da página o perderia).
 * Quem prefere outra aba tem o link no topo, e o link da própria sugestão
 * também abre em aba nova com Ctrl/⌘+clique.
 */
export function FolhaDoArtigo({ artigoId, onFechar }: { artigoId: number | null; onFechar: () => void }) {
  const { data: artigo, isLoading, isError } = useArtigo(artigoId ?? 0)
  return (
    <DialogPrimitive.Root open={artigoId != null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[400] bg-sobreposicao" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-[401] flex w-full max-w-xl flex-col bg-superficie text-tinta shadow-elevacao-3 focus-visible:outline-none"
          aria-describedby={undefined}
        >
          <header className="flex items-center gap-2 border-b border-divisoria px-4 py-3 md:px-6">
            <span className="min-w-0 flex-1 truncate text-corpo font-medio text-tinta-secundaria">Central de Ajuda</span>
            {artigoId != null && (
              <Link
                to={`/portal/ajuda/${artigoId}`}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              >
                <IconExternalLink /> Abrir em nova aba
              </Link>
            )}
            <DialogPrimitive.Close className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))} aria-label="Fechar artigo">
              <IconX />
            </DialogPrimitive.Close>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
            {isLoading ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                <DialogPrimitive.Title className="sr-only">Carregando artigo</DialogPrimitive.Title>
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : isError || !artigo ? (
              <>
                <DialogPrimitive.Title className="text-titulo font-forte">Artigo indisponível</DialogPrimitive.Title>
                <p className="mt-1 text-corpo text-tinta-secundaria">
                  Não foi possível abrir este artigo agora. Tente pela Central de Ajuda.
                </p>
              </>
            ) : (
              <article>
                {/* o título do diálogo É o título do artigo — o leitor de tela anuncia o que abriu */}
                <DialogPrimitive.Title className="text-titulo-lg font-forte leading-justa">{artigo.title}</DialogPrimitive.Title>
                {artigo.body_html ? (
                  // HTML higienizado no servidor (nh3) — ver PaginaArtigo
                  <div className={cn(ESTILO_ARTIGO, 'mt-2')} dangerouslySetInnerHTML={{ __html: artigo.body_html }} />
                ) : (
                  <p className="mt-4 text-corpo text-tinta-secundaria">{artigo.excerpt || 'Este artigo ainda não tem conteúdo publicado.'}</p>
                )}
              </article>
            )}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-divisoria px-4 py-3 md:px-6">
            <span className="text-pequeno text-tinta-secundaria">Não resolveu? Seu chamado continua aqui.</span>
            <DialogPrimitive.Close className={buttonVariants({ size: 'sm' })}>Voltar ao chamado</DialogPrimitive.Close>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
