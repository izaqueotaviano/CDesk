import { Esqueleto } from '@/ui/Esqueleto'

/**
 * O carregamento dos cartões da Início com a forma da lista que vem: marca à
 * esquerda, assunto e linha de apoio, prazo à direita — em vez de um
 * "Carregando…" solto, que fazia o cartão pular de altura quando os itens
 * chegavam. `rotulo` é o que o leitor de tela ouve; o desenho é decorativo.
 * As medidas moram em inicio.scss (`.inicio-lista__item--esqueleto`).
 */
export function EsqueletoLista({
  rotulo,
  linhas = 3,
  avatar = false,
}: {
  rotulo: string
  linhas?: number
  /** Fila de chat: a linha começa com o avatar do cliente, não com a barra. */
  avatar?: boolean
}) {
  return (
    <div role="status">
      <span className="sr-only">{rotulo}</span>
      <ul className="inicio-lista__itens" aria-hidden="true">
        {Array.from({ length: linhas }, (_, i) => (
          <li key={i} className="inicio-lista__item inicio-lista__item--esqueleto">
            <Esqueleto
              variante={avatar ? 'avatar' : 'texto'}
              className={avatar ? 'inicio-lista__esq-avatar' : 'inicio-lista__esq-barra'}
            />
            <span className="inicio-lista__texto">
              <Esqueleto className="inicio-lista__esq-assunto" />
              <Esqueleto className="inicio-lista__esq-meta" />
            </span>
            <Esqueleto className="inicio-lista__esq-lado" />
          </li>
        ))}
      </ul>
    </div>
  )
}
