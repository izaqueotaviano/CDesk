import { useId, useState, type KeyboardEvent } from 'react'
import type { Opcao } from './dimensoes'

/** A partir de quantas opções o campo "Filtrar opções" aparece: com a lista
 *  inteira à vista numa olhada, um campo a mais só atrapalha. */
const LIMITE_PARA_BUSCA = 8

interface Props {
  rotulo: string
  opcoes: Opcao[]
  selecionados: string[]
  multiplo: boolean
  onAlternar: (valor: string) => void
  /** Foca a primeira opção (ou a busca) ao montar — o popover abre com o
   *  foco dentro dele; a folha do celular não. */
  focarAoMontar?: boolean
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Lista de opções de UMA dimensão de filtro — o miolo do popover da barra
 * (FiltroPopover) e de cada seção da folha do celular (FiltrosMobile).
 *
 * `role="listbox"` com opções que são botões de verdade: Enter/Espaço
 * funcionam de graça, as setas movem o foco entre elas (padrão WAI-ARIA de
 * listbox) e `aria-selected` diz o estado ao leitor de tela — a marca
 * visual ao lado é só o segundo sinal.
 */
export function OpcoesDoFiltro({
  rotulo,
  opcoes,
  selecionados,
  multiplo,
  onAlternar,
  focarAoMontar,
}: Props) {
  const [busca, setBusca] = useState('')
  const idLista = useId()
  const comBusca = opcoes.length > LIMITE_PARA_BUSCA
  const termo = semAcento(busca.trim())
  const visiveis = termo ? opcoes.filter((o) => semAcento(o.rotulo).includes(termo)) : opcoes
  const marcados = new Set(selecionados)

  function mover(e: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const itens = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    if (itens.length === 0) return
    e.preventDefault()
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement)
    const proximo =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? itens.length - 1
          : e.key === 'ArrowDown'
            ? Math.min(itens.length - 1, atual + 1)
            : Math.max(0, atual - 1)
    itens[proximo]?.focus()
  }

  return (
    <div className="filtro-opcoes">
      {comBusca && (
        <input
          type="search"
          className="filtro-opcoes__busca"
          placeholder="Filtrar opções"
          aria-label={`Filtrar opções de ${rotulo.toLowerCase()}`}
          aria-controls={idLista}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          autoFocus={focarAoMontar}
        />
      )}
      <div
        id={idLista}
        role="listbox"
        aria-label={rotulo}
        aria-multiselectable={multiplo || undefined}
        className="filtro-opcoes__lista"
        onKeyDown={mover}
      >
        {visiveis.map((o, i) => {
          const marcado = marcados.has(o.valor)
          return (
            <button
              key={o.valor}
              type="button"
              role="option"
              aria-selected={marcado}
              className={'filtro-opcoes__item' + (marcado ? ' filtro-opcoes__item--marcado' : '')}
              onClick={() => onAlternar(o.valor)}
              autoFocus={focarAoMontar && !comBusca && i === 0}
            >
              <span
                className={
                  'filtro-opcoes__marca' +
                  (multiplo ? ' filtro-opcoes__marca--caixa' : ' filtro-opcoes__marca--radio')
                }
                aria-hidden="true"
              >
                {/* O rádio é desenhado no CSS (o ponto do meio); a caixa usa o
                    ícone de check que o subset já tem. */}
                {marcado && multiplo && <i className="ti ti-check" />}
              </span>
              <span className="filtro-opcoes__rotulo">{o.rotulo}</span>{' '}
              {o.contagem != null && (
                <span className={'filtro-opcoes__contagem' + (o.contagem === 0 ? ' is-zero' : '')}>
                  {o.contagem}
                </span>
              )}
            </button>
          )
        })}
        {visiveis.length === 0 && (
          <p className="filtro-opcoes__vazio">
            {opcoes.length === 0
              ? 'Nenhum ticket com esse campo agora.'
              : 'Nenhuma opção com esse nome.'}
          </p>
        )}
      </div>
    </div>
  )
}
