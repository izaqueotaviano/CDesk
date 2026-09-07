import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useTabs } from '@/stores/tabs'
import { PaginaPendente } from '@/ui/PaginaPendente'

/**
 * Prova de ponta a ponta do contrato de abas (docs/06): abrir um ticket
 * registra a aba no store (local, síncrono), que por sua vez agenda o
 * espelho no servidor. O conteúdo de verdade (conversa, propriedades,
 * anexos) é a próxima etapa — fora do escopo desta base.
 */
export function PaginaDetalheTicket() {
  const { id } = useParams<{ id: string }>()
  const abrirTicket = useTabs((s) => s.abrirTicket)
  const ticketId = Number(id)

  useEffect(() => {
    if (Number.isFinite(ticketId)) abrirTicket(ticketId)
    // abrirTicket() só precisa rodar quando o id da rota muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId])

  return <PaginaPendente titulo={`Ticket #${id}`} nota="Conversa, propriedades e anexos: próxima etapa." />
}
