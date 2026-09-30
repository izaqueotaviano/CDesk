import { Esqueleto } from '@/ui/Esqueleto'

/** Quantos cartões cada coluna fantasma tem — desiguais de propósito: quatro
 *  colunas iguais leem como padrão decorativo, não como um quadro. */
const CARTOES_POR_COLUNA = [3, 2, 1, 0]

/**
 * Placeholder com a forma do quadro: cabeçalho, filtros, colunas e cartões
 * onde eles vão aparecer. Um "Carregando…" no meio da tela não dizia nada
 * sobre o que vinha, e a troca para o quadro cheio era um salto de layout.
 */
export function EsqueletoQuadro() {
  return (
    <div className="kb-pagina" aria-busy="true">
      <span className="kb-sr" role="status">
        Carregando quadro
      </span>
      <header className="kb-pagina__header" aria-hidden="true">
        <div className="kb-esq kb-esq--cabecalho">
          <Esqueleto className="kb-esq__titulo" />
          <Esqueleto className="kb-esq__linha kb-esq__linha--longa" />
        </div>
      </header>
      <div className="kb-filtros" aria-hidden="true">
        <Esqueleto variante="bloco" className="kb-esq__busca" />
        <div className="kb-filtros__pilulas">
          {[0, 1, 2, 3].map((i) => (
            <Esqueleto key={i} variante="bloco" className="kb-esq__pilula" />
          ))}
        </div>
      </div>
      <div className="kb-pagina__colunas" aria-hidden="true">
        {CARTOES_POR_COLUNA.map((n, i) => (
          <div key={i} className="kb-coluna kb-coluna--esqueleto">
            <div className="kb-coluna__cabecalho">
              <Esqueleto className="kb-esq__linha kb-esq__linha--nome" />
            </div>
            <div className="kb-coluna__corpo">
              {Array.from({ length: n }, (_, j) => (
                <div key={j} className="kb-cartao kb-cartao--esqueleto">
                  <Esqueleto className="kb-esq__linha kb-esq__linha--ref" />
                  <Esqueleto className="kb-esq__linha kb-esq__linha--assunto" />
                  <Esqueleto className="kb-esq__linha kb-esq__linha--cliente" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
