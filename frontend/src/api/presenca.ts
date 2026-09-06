import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Presence } from '@/api/types'

/** Rótulo em português num lugar só — `QuemEstaOnline` e `PainelChat` já
 *  traduziam `presence` cada um do seu jeito (e nenhum dos dois cobria os
 *  três valores). Quem for unificá-los depois lê daqui. */
export const ROTULO_PRESENCA: Record<Presence, string> = {
  available: 'Disponível',
  away: 'Ausente',
  offline: 'Offline',
}

/** Ordem em que as opções aparecem no menu: do mais disponível ao menos. */
export const PRESENCAS: Presence[] = ['available', 'away', 'offline']

/**
 * Muda a própria presença (`apps/accounts/views.py::MyPresenceView`). Só
 * interno: para cliente a view devolve 400, então quem renderiza o controle
 * precisa checar `is_internal` antes — não é o hook que esconde isso.
 */
export function useMudarPresenca() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (presenca: Presence) =>
      api.post<{ presence: Presence }>('/api/v1/me/presence/', { presence: presenca }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      // As duas listas de agentes que mostram presença na tela, cada uma com
      // sua chave: `['agentes']` (cvz/tickets/dados.ts) alimenta "Equipe agora"
      // em resolv/inicio/QuemEstaOnline.tsx, e `['users','internos']`
      // (api/chat.ts) alimenta o seletor de transferência do PainelChat, que
      // escreve "(ausente)" ao lado do nome. Sem invalidar as duas, a pessoa
      // muda o status e continua aparecendo com o antigo ao lado do novo.
      // O socket não cobre isto: realtime/bridge.ts recebe `agent_presence` e
      // faz `break` sem invalidar nada — hoje esta é a única atualização.
      qc.invalidateQueries({ queryKey: ['agentes'] })
      qc.invalidateQueries({ queryKey: ['users', 'internos'] })
    },
  })
}
