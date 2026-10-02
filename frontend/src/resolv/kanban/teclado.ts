import { KeyboardCode, type KeyboardCoordinateGetter } from '@dnd-kit/core'

/** Espaço pega e solta; Esc cancela. Enter fica de fora de propósito: no
 *  cartão parado ele ABRE o chamado, e usar a mesma tecla para soltar faria
 *  o mesmo aperto soltar e navegar. */
export const TECLAS_DO_QUADRO = {
  start: [KeyboardCode.Space],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space],
}

/**
 * Setas esquerda/direita pulam de COLUNA em coluna com o cartão pego pelo
 * teclado. O padrão do dnd-kit anda 25px por tecla: numa coluna de ~280px
 * eram onze apertos para chegar na vizinha, e nada dizia quando se tinha
 * chegado. Aqui cada seta é uma coluna, e o anúncio (em PaginaKanban.tsx)
 * diz qual.
 *
 * O destino é o topo da coluna vizinha, logo abaixo do cabeçalho: é onde o
 * `closestCorners` reconhece a coluna sem ambiguidade. Cima/baixo não fazem
 * nada (a ordem dentro da coluna vem do servidor, não do arraste).
 */
export const coordenadasPorColuna: KeyboardCoordinateGetter = (event, { context }) => {
  const passo = event.code === KeyboardCode.Right ? 1 : event.code === KeyboardCode.Left ? -1 : 0
  if (event.code === KeyboardCode.Up || event.code === KeyboardCode.Down) {
    event.preventDefault() // sem isto a seta rolaria a página no meio do arraste
    return undefined
  }
  if (!passo) return undefined
  event.preventDefault()

  const { collisionRect, droppableRects, droppableContainers, over } = context
  if (!collisionRect) return undefined

  const colunas = droppableContainers
    .getEnabled()
    .map((c) => ({ id: c.id, rect: droppableRects.get(c.id) }))
    .filter((c): c is { id: typeof c.id; rect: NonNullable<typeof c.rect> } => c.rect != null)
    .sort((a, b) => a.rect.left - b.rect.left)
  if (colunas.length === 0) return undefined

  const centro = collisionRect.left + collisionRect.width / 2
  let atual = colunas.findIndex((c) => c.id === over?.id)
  if (atual < 0) atual = colunas.findIndex((c) => centro >= c.rect.left && centro <= c.rect.right)
  const alvo =
    atual >= 0
      ? colunas[atual + passo]
      : passo > 0
        ? colunas.find((c) => c.rect.left > centro)
        : [...colunas].reverse().find((c) => c.rect.right < centro)
  if (!alvo) return undefined

  return {
    x: alvo.rect.left + Math.max(0, (alvo.rect.width - collisionRect.width) / 2),
    y: alvo.rect.top + 48,
  }
}
