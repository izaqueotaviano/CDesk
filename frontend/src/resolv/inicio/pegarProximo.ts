import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'
import type { Prioridade, TicketLinha } from '../tickets/tipos'

/**
 * O que "Pegar o próximo" considera: sem responsável e esperando a EQUIPE
 * (novo ou aberto). "Aguardando o cliente" fica de fora de propósito: ali a
 * bola está com o cliente, e pegar um chamado desses não adianta o
 * atendimento de ninguém. O recorte de visibilidade (`visible_tickets`) o
 * backend já aplica em toda listagem — só entra o que a pessoa pode abrir.
 */
const SEM_DONO = 'assignee=unassigned&status=new,open'

const PESO_PRIORIDADE: Record<Prioridade, number> = { urgent: 4, high: 3, normal: 2, low: 1 }

function prazo(t: TicketLinha): number {
  const due = t.sla.resolution.due_at
  const ms = due ? Date.parse(due) : NaN
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

/**
 * A ordem de "mais urgente": o prazo de SLA que vence primeiro (sem prazo vai
 * por último), depois a prioridade mais alta, depois o mais antigo. O prazo é
 * o de RESOLUÇÃO, o mesmo que a coluna SLA da fila mostra e ordena
 * (`ordering=sla` no backend): as duas telas não podem discordar sobre qual
 * chamado aperta mais.
 */
export function compararUrgencia(a: TicketLinha, b: TicketLinha): number {
  const pa = prazo(a)
  const pb = prazo(b)
  if (pa !== pb) return pa < pb ? -1 : 1
  const prioridade = PESO_PRIORIDADE[b.priority] - PESO_PRIORIDADE[a.priority]
  if (prioridade !== 0) return prioridade
  return Date.parse(a.created_at) - Date.parse(b.created_at)
}

function listar(extra: string) {
  return api.get<Paginado<TicketLinha>>(`/api/v1/tickets/?${SEM_DONO}&${extra}`)
}

/**
 * Escolhe o próximo chamado com a listagem que já existe, sem endpoint novo.
 *
 * A listagem ordena por UMA coluna só, então a regra de três critérios sai em
 * até três pedidos pequenos:
 *
 * 1. Pelo prazo (`ordering=sla`, sem prazo por último). Se o primeiro tem
 *    prazo, o mais urgente está nesta página; os empates de prazo se
 *    resolvem aqui mesmo, por prioridade e idade.
 * 2. Ninguém tem prazo: a prioridade mais alta que existe (`-urgencia`)…
 * 3. …e, dentro dela, o mais antigo (`priority=X&ordering=criado`). Pedir a
 *    prioridade primeiro e a idade depois é o que garante o mais antigo de
 *    verdade, e não só o mais antigo das primeiras linhas.
 */
export async function escolherProximo(): Promise<TicketLinha | null> {
  const porPrazo = await listar('ordering=sla&limit=20')
  if (porPrazo.results.length === 0) return null

  const comPrazo = porPrazo.results.filter((t) => prazo(t) !== Number.POSITIVE_INFINITY)
  if (comPrazo.length > 0) return [...comPrazo].sort(compararUrgencia)[0]

  const porPrioridade = await listar('ordering=-urgencia&limit=1')
  const topo = porPrioridade.results[0]
  if (!topo) return null
  const maisAntigo = await listar(`priority=${topo.priority}&ordering=criado&limit=1`)
  return maisAntigo.results[0] ?? topo
}

/** Não sobrou nada para pegar entre a contagem e o clique — alguém pegou
 *  antes, ou o último foi fechado. Não é falha de rede: a tela diz outra coisa. */
export class NadaParaPegar extends Error {
  constructor() {
    super('Nenhum chamado sem responsável agora.')
    this.name = 'NadaParaPegar'
  }
}

/**
 * Quantos chamados estão à espera de alguém pegar. Mora sob o prefixo
 * `['tickets']` para a ponte de tempo real (realtime/bridge.ts) invalidar
 * junto com a fila: um chamado novo chegando já acende o botão.
 */
export function useQuantosSemDono() {
  return useQuery({
    queryKey: ['tickets', 'sem-dono'],
    queryFn: () => listar('limit=1'),
    select: (d: Paginado<TicketLinha>) => d.count,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Escolhe e atribui a quem clicou, pelo mesmo `POST /tickets/{id}/assign/`
 * do detalhe do chamado. Devolve o chamado pego, para a tela abrir.
 */
export function usePegarProximo(meuId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (meuId == null) throw new Error('Sessão sem usuário.')
      const proximo = await escolherProximo()
      if (!proximo) throw new NadaParaPegar()
      await api.post(`/api/v1/tickets/${proximo.id}/assign/`, { assignee_id: meuId })
      return proximo
    },
    // Dando certo ou não, a contagem e as listas mudaram (pegamos um, ou
    // descobrimos que alguém pegou antes).
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] })
      qc.invalidateQueries({ queryKey: ['kpi'] })
    },
  })
}
