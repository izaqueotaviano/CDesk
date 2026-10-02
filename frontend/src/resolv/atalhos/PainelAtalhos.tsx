import { useId, useRef } from 'react'
import { useFocusTrap } from '@/cvz/hooks'
import { GRUPOS_ATALHOS, rotuloDaTecla } from './catalogo'
import { usePainelAtalhos } from './estado'
import './atalhos.scss'

/**
 * Lista de TODOS os atalhos do console, lida do catálogo — o painel nunca
 * promete uma tecla que o despachante não conhece, e vice-versa.
 *
 * Diálogo modal de verdade: foco preso (`useFocusTrap`, o mesmo da busca),
 * Esc fecha, clique no véu fecha, e o foco volta para onde estava. Enquanto
 * ele está aberto o despachante não dispara nada (`haModalAberto`), então
 * apertar `r` aqui dentro não começa uma resposta por baixo.
 */
export function PainelAtalhos() {
  const aberto = usePainelAtalhos((s) => s.aberto)
  const fechar = usePainelAtalhos((s) => s.fechar)
  const painelRef = useRef<HTMLDivElement>(null)
  const idTitulo = useId()

  useFocusTrap(painelRef, aberto)

  if (!aberto) return null

  return (
    <div
      className="painel-atalhos__veu"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) fechar()
      }}
    >
      <div
        ref={painelRef}
        className="painel-atalhos"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === '?') {
            e.preventDefault()
            e.stopPropagation()
            fechar()
          }
        }}
      >
        <header className="painel-atalhos__topo">
          <h2 id={idTitulo} className="painel-atalhos__titulo">
            Atalhos de teclado
          </h2>
          <button
            type="button"
            className="painel-atalhos__fechar"
            aria-label="Fechar atalhos de teclado"
            onClick={fechar}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </header>

        <div className="painel-atalhos__grupos">
          {GRUPOS_ATALHOS.map((grupo) => (
            <section key={grupo.id} className="painel-atalhos__grupo" aria-labelledby={`${idTitulo}-${grupo.id}`}>
              <h3 id={`${idTitulo}-${grupo.id}`} className="painel-atalhos__grupo-titulo">
                {grupo.titulo}
              </h3>
              <dl className="painel-atalhos__lista">
                {grupo.atalhos.map((a) => (
                  <div key={a.id} className="painel-atalhos__linha">
                    <dt className="painel-atalhos__teclas">
                      {a.combinacoes.map((seq, i) => (
                        <span key={i} className="painel-atalhos__combinacao">
                          {i > 0 && <span className="painel-atalhos__ou">ou</span>}
                          {seq.map((tecla, j) => (
                            <span key={j} className="painel-atalhos__passo">
                              {j > 0 && <span className="painel-atalhos__depois">depois</span>}
                              <kbd>{rotuloDaTecla(tecla)}</kbd>
                            </span>
                          ))}
                        </span>
                      ))}
                    </dt>
                    <dd className="painel-atalhos__descricao">{a.descricao}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="painel-atalhos__rodape">
          Os atalhos ficam desligados enquanto você digita num campo ou com uma janela aberta.
        </p>
      </div>
    </div>
  )
}
