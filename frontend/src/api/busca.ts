import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

/**
 * Busca global do cabeçalho — `GET /api/v1/search/?q=`
 * (`apps/core/views.py::GlobalSearchView`, permissão `IsInternal`).
 *
 * As três listas vêm numa resposta só e cada uma é PRÉVIA (o backend corta em
 * 8 por grupo): quem quer a lista inteira já tem a tela dedicada dela. Por
 * isso não há paginação aqui — não é listagem, é dropdown.
 */

export interface ChamadoEncontrado {
  id: number
  reference: string
  subject: string
  company_name: string
  /** Chamado sem estágio existe — a view manda `null` quando `t.stage` é nulo. */
  stage_name: string | null
}

export interface EmpresaEncontrada {
  id: number
  name: string
  slug: string
}

export interface SolicitanteEncontrado {
  id: number
  full_name: string
  email: string
  /** Cliente sem empresa vinculada existe no modelo — os dois campos vêm
   *  `null` juntos nesse caso (`u.company_id` / `u.company.name`). */
  company_id: number | null
  company_name: string | null
  /** `create_ticket` exige solicitante ativo — quem oferece este resultado
   *  como "Para" de um chamado novo precisa poder recusar antes do clique,
   *  não deixar o servidor devolver "Cliente não encontrado" sobre alguém
   *  que existe, só está inativo. */
  is_active: boolean
}

export interface ResultadoBusca {
  tickets: ChamadoEncontrado[]
  companies: EmpresaEncontrada[]
  requesters: SolicitanteEncontrado[]
}

/** Mesmo piso do backend, repetido aqui de propósito: lá termo com menos de 2
 *  caracteres devolve os três grupos vazios sem consultar o banco, então a
 *  requisição seria uma ida e volta de resultado garantidamente vazio. Quem
 *  digita a primeira letra não está buscando ainda. */
export const MINIMO_PARA_BUSCAR = 2

export function useBuscaGlobal(termo: string) {
  const limpo = termo.trim()
  return useQuery({
    queryKey: ['busca-global', limpo],
    queryFn: () => api.get<ResultadoBusca>(`/api/v1/search/?q=${encodeURIComponent(limpo)}`),
    enabled: limpo.length >= MINIMO_PARA_BUSCAR,
    // Curto: o resultado envelhece rápido (chamado novo, empresa nova) e o
    // custo de reconsultar é baixo — mas voltar num termo recém-digitado
    // (apagar uma letra e refazer) não deve piscar nem bater no servidor.
    staleTime: 15_000,
  })
}
