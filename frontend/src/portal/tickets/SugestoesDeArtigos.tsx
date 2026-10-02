import { IconBook } from '@tabler/icons-react'
import { MINIMO_PARA_SUGERIR, useSugestoesDeArtigos } from '../api/ajuda'
import { useValorComAtraso } from '../lib/atraso'

/**
 * "Isso pode resolver" — até três artigos da Central de Ajuda para o assunto
 * que a pessoa está escrevendo.
 *
 * Nunca atrapalha: não aparece sem resultado, não mostra erro (sugestão que
 * falhou só não aparece), não trava o envio e não rouba o foco. Cada item é
 * um link de verdade para o artigo — Ctrl/⌘+clique abre em outra aba como
 * qualquer link —, e o clique simples abre a folha lateral por cima do
 * formulário (`onAbrir`), sem perder o que foi escrito.
 */
export function SugestoesDeArtigos({ assunto, onAbrir }: { assunto: string; onAbrir: (id: number) => void }) {
  // espera a pessoa parar de digitar antes de perguntar ao servidor
  const texto = useValorComAtraso(assunto, 350)
  const pronto = texto.trim().length >= MINIMO_PARA_SUGERIR
  const { data } = useSugestoesDeArtigos(pronto ? texto : '')
  const artigos = pronto ? (data ?? []) : []

  return (
    // região viva sempre montada: o leitor de tela só anuncia o que ENTRA
    // numa região que já existia
    <div aria-live="polite">
      {artigos.length > 0 && (
        <section aria-label="Artigos que podem resolver" className="mt-1.5 flex flex-col gap-1 rounded-md bg-navegacao p-2">
          <h2 className="px-2 pt-1 text-pequeno font-medio text-tinta-secundaria">Isso pode resolver</h2>
          {/* `role="list"` num div, e não <ul>: o index.css sublinha todo link
              dentro de <li> (link no meio de texto), e aqui a linha inteira é o link */}
          <div role="list" className="flex flex-col">
            {artigos.map((a) => (
              <div role="listitem" key={a.id}>
                <a
                  href={`/portal/ajuda/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    // clique simples: folha lateral; com modificador, a aba nova de sempre
                    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
                    e.preventDefault()
                    onAbrir(a.id)
                  }}
                  className="flex items-start gap-2.5 rounded-sm px-2 py-2 transition-colors hover:bg-navegacao-hover"
                >
                  <IconBook className="mt-0.5 size-4 shrink-0 text-tinta-secundaria" stroke={1.75} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-corpo font-medio text-tinta">{a.title}</span>
                    {a.excerpt && <span className="line-clamp-1 text-pequeno text-tinta-secundaria">{a.excerpt}</span>}
                  </span>
                </a>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
