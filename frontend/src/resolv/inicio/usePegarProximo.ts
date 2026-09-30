import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Paginado } from '@/api/client'
import type { TicketLinha } from '../tickets/tipos'

/**
 * O recorte que a contagem ao lado do botão usa — o MESMO que o servidor usa
 * ao pegar (`take_next` em apps/tickets/views.py): sem responsável e
 * esperando a EQUIPE (novo ou aberto). "Aguardando o cliente" fica de fora de
 * propósito: ali a bola está com o cliente. A visibilidade (`visible_tickets`)
 * o backend aplica nos dois.
 */
const SEM_DONO = 'assignee=unassigned&status=new,open'

function listar(extra: string) {
  return api.get<Paginado<TicketLinha>>(`/api/v1/tickets/?${SEM_DONO}&${extra}`)
}

/** Não sobrou nada para pegar entre a contagem e o clique — alguém pegou
 *  antes, ou o último foi fechado. Não é falha de rede: a tela diz outra coisa. */
export class NadaParaPegar extends Error {
  constructor() {
    super('Nenhum ticket sem responsável agora.')
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
 * Pega o próximo chamado numa ação só do servidor (`POST /tickets/take-next/`):
 * escolher e atribuir acontecem na mesma transação, com a linha travada. Antes
 * a tela escolhia pela listagem e atribuía num segundo pedido — dois agentes
 * clicando juntos pegavam o MESMO chamado. A ordem (prazo de SLA de
 * resolução, depois prioridade, depois o mais antigo) mora no backend.
 * Devolve o chamado pego, para a tela abrir.
 */
export function usePegarProximo(meuId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (meuId == null) throw new Error('Sessão sem usuário.')
      try {
        return await api.post<TicketLinha>('/api/v1/tickets/take-next/')
      } catch (erro) {
        if (erro instanceof ApiError && erro.status === 409 && erro.code === 'nada_para_pegar') {
          throw new NadaParaPegar()
        }
        throw erro
      }
    },
    // Dando certo ou não, a contagem e as listas mudaram (pegamos um, ou
    // descobrimos que alguém pegou antes).
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] })
      qc.invalidateQueries({ queryKey: ['kpi'] })
    },
  })
}
