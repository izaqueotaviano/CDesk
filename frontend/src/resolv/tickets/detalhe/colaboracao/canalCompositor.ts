import { create } from 'zustand'

/**
 * Ponte entre o compositor e o resto do detalhe, nos dois sentidos, sem que
 * um importe o outro:
 *
 *  - compositor → detalhe: "estou digitando uma resposta/nota" (ou parei). A
 *    presença (`usePresencaTicket`) lê daqui e avisa os colegas;
 *  - detalhe → compositor: "abra em resposta ao cliente / nota interna e
 *    foque" — os atalhos `r` e `n`.
 *
 * O compositor é de outra área (o texto rico, anexos e menções moram lá), e
 * a única coisa que ele precisa saber disto é UMA chamada de hook
 * (`useCompositorColaborativo`). Por ticket, porque a pessoa pode ter mais de
 * um chamado aberto em "Trabalhando agora" e cada um tem o seu compositor.
 */

export type ModoCompositor = 'resposta' | 'nota'

interface EstadoDigitacao {
  /** O que ESTA aba está digitando agora, por ticket. Ausente = nada. */
  porTicket: Record<number, ModoCompositor | undefined>
  relatar: (ticketId: number, modo: ModoCompositor | null) => void
}

export const useDigitacaoLocal = create<EstadoDigitacao>()((set) => ({
  porTicket: {},
  relatar: (ticketId, modo) =>
    set((s) =>
      (s.porTicket[ticketId] ?? null) === modo
        ? s
        : { porTicket: { ...s.porTicket, [ticketId]: modo ?? undefined } },
    ),
}))

type OuvinteCompositor = (modo: ModoCompositor) => void
const ouvintes = new Map<number, Set<OuvinteCompositor>>()

/** O compositor do ticket se inscreve para receber os pedidos de `r`/`n`. */
export function ouvirPedidosDoCompositor(ticketId: number, ouvinte: OuvinteCompositor) {
  const conjunto = ouvintes.get(ticketId) ?? new Set()
  conjunto.add(ouvinte)
  ouvintes.set(ticketId, conjunto)
  return () => {
    conjunto.delete(ouvinte)
    if (conjunto.size === 0) ouvintes.delete(ticketId)
  }
}

/** Pede ao compositor do ticket para abrir no modo e focar. Devolve `false`
 *  quando não há compositor montado (conteúdo restrito, sem permissão). */
export function pedirCompositor(ticketId: number, modo: ModoCompositor): boolean {
  const conjunto = ouvintes.get(ticketId)
  if (!conjunto || conjunto.size === 0) return false
  conjunto.forEach((o) => o(modo))
  return true
}
