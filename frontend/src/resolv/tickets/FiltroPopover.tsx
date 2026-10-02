import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  /** Nome da dimensão ("Status") — é também o nome acessível do popover. */
  rotulo: string
  /** Valor atual em texto curto ("Alta, Urgente"). Nulo = filtro desligado. */
  resumo: string | null
  /** Desliga o filtro sem abrir o popover (o "×" da pílula ativa). */
  onLimpar?: () => void
  icone?: string
  /** Conteúdo do popover; recebe `fechar` para quem escolhe e sai (valor
   *  único) devolver o foco à pílula. */
  children: (fechar: () => void) => ReactNode
  className?: string
}

const MARGEM = 8

/**
 * Pílula de filtro + popover. Não é o `MenuFlutuante` do shell: aquele é
 * `role="menu"` (ação e sai), e aqui a pessoa marca várias opções, digita
 * num campo de busca e só depois sai — é um diálogo não modal pequeno.
 *
 * Esc e clique fora fecham; Esc devolve o foco à pílula (o clique fora não —
 * a pessoa já foi para outro lugar). O popover ancora na pílula e vira para
 * a esquerda quando não cabe à direita da janela.
 */
export function FiltroPopover({ rotulo, resumo, onLimpar, icone, children, className }: Props) {
  const [aberto, setAberto] = useState(false)
  const refRaiz = useRef<HTMLDivElement>(null)
  const refGatilho = useRef<HTMLButtonElement>(null)
  const refPopover = useRef<HTMLDivElement>(null)
  const idPopover = useId()
  const ativo = resumo != null

  // Devolver o foco à pílula é pedido por contador e cumprido num efeito:
  // `fechar` vai para o render dos filhos, e ali não se toca em ref.
  const [pedidosDeFoco, setPedidosDeFoco] = useState(0)
  useEffect(() => {
    if (pedidosDeFoco > 0) refGatilho.current?.focus()
  }, [pedidosDeFoco])

  function fechar(devolverFoco = true) {
    setAberto(false)
    if (devolverFoco) setPedidosDeFoco((n) => n + 1)
  }

  useLayoutEffect(() => {
    const el = refPopover.current
    if (!aberto || !el) return
    el.classList.remove('filtro__popover--fim')
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth - MARGEM) el.classList.add('filtro__popover--fim')
  }, [aberto])

  // Clique fora fecha. `mousedown`, não `click`: fechar no click chegaria
  // depois do clique que abriu outra pílula e fecharia a nova também.
  useEffect(() => {
    if (!aberto) return
    const aoPressionar = (e: MouseEvent) => {
      if (refRaiz.current?.contains(e.target as Node)) return
      setAberto(false)
    }
    document.addEventListener('mousedown', aoPressionar)
    return () => document.removeEventListener('mousedown', aoPressionar)
  }, [aberto])

  return (
    <div
      ref={refRaiz}
      className={'filtro' + (ativo ? ' filtro--ativo' : '') + (className ? ` ${className}` : '')}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && aberto) {
          e.preventDefault()
          // Sem isto o Esc seguiria até quem escuta o documento (atalhos
          // globais, o fechar-aba do shell) e faria duas coisas de uma vez.
          e.stopPropagation()
          fechar()
        }
      }}
    >
      <button
        ref={refGatilho}
        type="button"
        className="filtro__pilula"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-controls={aberto ? idPopover : undefined}
        onClick={() => setAberto((a) => !a)}
      >
        {icone && <i className={icone} aria-hidden="true" />}
        {ativo ? (
          <>
            <span className="filtro__rotulo">{rotulo}:</span>{' '}
            <span className="filtro__valor">{resumo}</span>
          </>
        ) : (
          <>
            <span>{rotulo}</span>
            <i className="ti ti-chevron-down filtro__seta" aria-hidden="true" />
          </>
        )}
      </button>
      {ativo && onLimpar && (
        <button
          type="button"
          className="filtro__limpar"
          aria-label={`Limpar filtro ${rotulo.toLowerCase()}`}
          title="Limpar"
          onClick={() => {
            onLimpar()
            refGatilho.current?.focus()
          }}
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      )}
      {aberto && (
        <div
          ref={refPopover}
          id={idPopover}
          role="dialog"
          aria-label={rotulo}
          className="filtro__popover"
        >
          {children(fechar)}
        </div>
      )}
    </div>
  )
}
