import { useQueries } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'

/**
 * KPIs da home — cada card é uma contagem REAL vinda do `count` da paginação
 * do /api/v1/tickets/ (LimitOffsetPagination devolve o total mesmo com
 * limit=1). Uma query por card, em paralelo. Nada de número inventado: se um
 * card não tem fonte confiável no backend, ele não entra aqui.
 */
export interface Kpi {
  chave: string
  rotulo: string
  valor: number | null
  tom?: 'accent' | 'danger' | 'ok'
}

const CARDS: { chave: string; rotulo: string; query: string; tom?: Kpi['tom'] }[] = [
  { chave: 'nao-resolvidos', rotulo: 'Não resolvidos', query: 'view=nao-resolvidos' },
  { chave: 'nao-atribuidos', rotulo: 'Sem responsável', query: 'view=nao-atribuidos', tom: 'accent' },
  { chave: 'sla-risco', rotulo: 'SLA em risco', query: 'sla=at_risk', tom: 'danger' },
  { chave: 'sla-estourado', rotulo: 'SLA estourado', query: 'sla=breached', tom: 'danger' },
  { chave: 'meus', rotulo: 'Meus tickets', query: 'view=meus-nao-resolvidos' },
  { chave: 'resolvidos', rotulo: 'Resolvidos', query: 'view=resolvidos', tom: 'ok' },
]

export function useKpis(): { kpis: Kpi[]; carregando: boolean } {
  const results = useQueries({
    queries: CARDS.map((c) => ({
      queryKey: ['kpi', c.chave],
      queryFn: () => api.get<Paginado<unknown>>(`/api/v1/tickets/?${c.query}&limit=1`),
      staleTime: 30_000,
      select: (d: Paginado<unknown>) => d.count,
    })),
  })

  const kpis: Kpi[] = CARDS.map((c, i) => ({
    chave: c.chave,
    rotulo: c.rotulo,
    valor: (results[i].data as number | undefined) ?? null,
    tom: c.tom,
  }))

  return { kpis, carregando: results.some((r) => r.isLoading) }
}
