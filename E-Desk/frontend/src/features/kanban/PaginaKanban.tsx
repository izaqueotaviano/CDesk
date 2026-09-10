import { PaginaPendente } from '@/ui/PaginaPendente'

/** Quadro com dnd-kit (acessível por teclado e toque — docs/07-arquitetura-frontend.md
 *  rejeita DnD nativo HTML5 por não ter nenhum dos dois). */
export function PaginaKanban() {
  return <PaginaPendente titulo="Kanban" />
}
