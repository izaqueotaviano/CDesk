import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'

export type TipoAviso = 'info' | 'urgent' | 'holiday' | 'vacation'

/** Mural: só o que a PRÓPRIA pessoa vê — o backend já filtra pela audiência
 *  (`apps.announcements.services.announcements_for`), fixados primeiro. */
export interface AvisoDoMural {
  id: number
  title: string
  body: string
  kind: TipoAviso
  is_pinned: boolean
  created_by_name: string | null
  dismissed: boolean
  created_at: string
}

export const chaveAvisos = ['avisos', 'mural'] as const

export function useAvisosDoMural() {
  return useQuery({
    queryKey: chaveAvisos,
    queryFn: () => api.get<Paginado<AvisoDoMural>>('/api/v1/announcements/?limit=50'),
    staleTime: 30_000,
    select: (d) => d.results.filter((a) => !a.dismissed),
  })
}

export function useDispensarAviso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ dismissed: true }>(`/api/v1/announcements/${id}/dismiss/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveAvisos }),
  })
}
