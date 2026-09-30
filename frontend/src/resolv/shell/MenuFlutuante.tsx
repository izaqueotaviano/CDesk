import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import './menu-flutuante.scss'

/**
 * Menu flutuante do shell — o mesmo componente atende os menus do console: o
 * menu de contexto de uma aba (botão direito, ancorado no PONTEIRO) e os
 * menus ancorados num botão que abrem no clique (o "Mais" da sidebar, os
 * filtros e as ações do quadro).
 *
 * Não é o `Popover` da cvzdesk de propósito: aquele se posiciona em relação
 * ao gatilho por CSS (`position: absolute` dentro do `.popover`), o que não
 * serve para um menu que nasce onde o mouse clicou, e não gerencia foco nem
 * setas entre itens — aqui é um `role="menu"` de verdade (padrão WAI-ARIA):
 * o foco entra no primeiro item ao abrir, setas circulam, Esc/Tab/clique fora
 * fecham, e Esc e a escolha de um item devolvem o foco pra âncora.
 *
 * `position: fixed` + medição no `useLayoutEffect`: o menu é posicionado
 * depois de saber o próprio tamanho, e recua se for estourar a janela — a
 * barra de abas fica no topo, então "para baixo" quase sempre cabe, mas o
 * menu de contexto de uma aba na ponta direita precisaria abrir para a
 * esquerda. A posição vai direto no `style` do nó (não em estado): é medida
 * de layout, não dado — e assim não há um segundo render só pra posicionar.
 */

export type ItemDoMenu =
  | {
      tipo?: 'item'
      rotulo: string
      icone?: string
      onSelecionar: () => void
      desabilitado?: boolean
      /** Ação destrutiva (fechar todas): pintada em `--danger`. */
      perigo?: boolean
    }
  | { tipo: 'separador' }

interface Props {
  aberto: boolean
  onFechar: () => void
  itens: ItemDoMenu[]
  /** Nome acessível do menu (`aria-label`). */
  rotulo: string
  /** Texto pequeno no topo ("Abrir rápido"). Opcional. */
  cabecalho?: ReactNode
  /** Gatilho: o menu abre logo abaixo dele e o foco volta pra ele ao fechar.
   *  Função, não o nó: refs só podem ser lidas fora do render. */
  obterAncora?: () => HTMLElement | null
  /** Ponto do ponteiro (menu de contexto). Tem precedência sobre a âncora
   *  para a POSIÇÃO; a âncora continua valendo pro retorno do foco. */
  posicao?: { x: number; y: number } | null
  alinhar?: 'inicio' | 'fim'
  /** Quem abre no hover não quer o foco roubado ao abrir (o ponteiro ainda
   *  está no gatilho); com o teclado o foco entra normalmente. */
  focarAoAbrir?: boolean
}

const MARGEM = 8

export function MenuFlutuante({
  aberto,
  onFechar,
  itens,
  rotulo,
  cabecalho,
  obterAncora,
  posicao,
  alinhar = 'inicio',
  focarAoAbrir = true,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  // "Última versão" da função de âncora, pra os efeitos abaixo não precisarem
  // dela nas dependências (ela é recriada a cada render de quem chama).
  // Atualizada num layout effect — declarado ANTES do de posicionamento,
  // que a lê — e não no render, onde ref não se escreve.
  const obterAncoraRef = useRef(obterAncora)
  useLayoutEffect(() => {
    obterAncoraRef.current = obterAncora
  })

  const selecionaveis = itens
    .map((item, indice) => ({ item, indice }))
    .filter(({ item }) => item.tipo !== 'separador' && !item.desabilitado)

  // Item focado, zerado a cada abertura — "estado derivado de prop" no
  // padrão do React (ajusta durante o render, sem efeito).
  const [indiceFocado, setIndiceFocado] = useState(-1)
  const [abertoVisto, setAbertoVisto] = useState(aberto)
  if (abertoVisto !== aberto) {
    setAbertoVisto(aberto)
    setIndiceFocado(aberto && focarAoAbrir ? (selecionaveis[0]?.indice ?? -1) : -1)
  }

  // Posiciona depois de medir — e só enquanto aberto.
  useLayoutEffect(() => {
    if (!aberto) return
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const ancora = obterAncoraRef.current?.()
    let left: number
    let top: number
    if (posicao) {
      left = posicao.x
      top = posicao.y
    } else if (ancora) {
      const r = ancora.getBoundingClientRect()
      left = alinhar === 'fim' ? r.right - width : r.left
      top = r.bottom + 4
    } else {
      left = MARGEM
      top = MARGEM
    }
    const maxLeft = window.innerWidth - width - MARGEM
    const maxTop = window.innerHeight - height - MARGEM
    el.style.left = `${Math.max(MARGEM, Math.min(left, maxLeft))}px`
    el.style.top = `${Math.max(MARGEM, Math.min(top, maxTop))}px`
    el.style.visibility = 'visible'
  }, [aberto, posicao, alinhar, itens.length])

  useEffect(() => {
    if (!aberto || indiceFocado < 0) return
    menuRef.current?.querySelector<HTMLButtonElement>(`[data-indice="${indiceFocado}"]`)?.focus()
  }, [aberto, indiceFocado])

  // Clique fora fecha. `mousedown` (não `click`): fechar no click chegava
  // DEPOIS do clique que abriu outro menu e fechava o novo também.
  useEffect(() => {
    if (!aberto) return
    const aoPressionar = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (menuRef.current?.contains(alvo)) return
      if (obterAncoraRef.current?.()?.contains(alvo)) return
      onFechar()
    }
    document.addEventListener('mousedown', aoPressionar)
    return () => document.removeEventListener('mousedown', aoPressionar)
  }, [aberto, onFechar])

  if (!aberto) return null

  /** Fechar por teclado ou por escolha devolve o foco pra quem abriu — o
   *  clique fora não (a pessoa já foi pra outro lugar). */
  function fecharEDevolverFoco() {
    const ancora = obterAncoraRef.current?.()
    onFechar()
    ancora?.focus()
  }

  function mover(direcao: 1 | -1) {
    if (selecionaveis.length === 0) return
    const posicaoAtual = selecionaveis.findIndex((s) => s.indice === indiceFocado)
    const proxima = (posicaoAtual + direcao + selecionaveis.length) % selecionaveis.length
    setIndiceFocado(selecionaveis[proxima]!.indice)
  }

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        mover(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        mover(-1)
        break
      case 'Home':
        e.preventDefault()
        if (selecionaveis[0]) setIndiceFocado(selecionaveis[0].indice)
        break
      case 'End':
        e.preventDefault()
        if (selecionaveis.length) setIndiceFocado(selecionaveis[selecionaveis.length - 1]!.indice)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        fecharEDevolverFoco()
        break
      case 'Tab':
        // Menu não é lugar de tabular: Tab sai dele (e fecha), como num menu
        // nativo do sistema — o foco segue pra onde o Tab levaria.
        onFechar()
        break
    }
  }

  return (
    <div
      ref={menuRef}
      className="menu-flutuante"
      role="menu"
      aria-label={rotulo}
      // Invisível até o useLayoutEffect medir e posicionar: sem isto o menu
      // piscaria no canto antes de pular para a posição certa.
      style={{ visibility: 'hidden', left: 0, top: 0 }}
      onKeyDown={aoTeclar}
      onContextMenu={(e) => e.preventDefault()}
    >
      {cabecalho && <div className="menu-flutuante__cabecalho">{cabecalho}</div>}
      {itens.map((item, indice) =>
        item.tipo === 'separador' ? (
          <div key={`sep-${indice}`} className="menu-flutuante__separador" role="separator" />
        ) : (
          <button
            key={item.rotulo}
            type="button"
            role="menuitem"
            data-indice={indice}
            tabIndex={indice === indiceFocado ? 0 : -1}
            className={'menu-flutuante__item' + (item.perigo ? ' menu-flutuante__item--perigo' : '')}
            disabled={item.desabilitado}
            aria-disabled={item.desabilitado || undefined}
            onMouseEnter={() => !item.desabilitado && setIndiceFocado(indice)}
            onClick={() => {
              fecharEDevolverFoco()
              item.onSelecionar()
            }}
          >
            {item.icone && <i className={item.icone} aria-hidden="true" />}
            <span>{item.rotulo}</span>
          </button>
        ),
      )}
    </div>
  )
}
