import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'

export interface RegistroAuditoria {
  id: number
  actor: number | null
  actor_name: string
  action: string
  target_type: string
  object_id: string
  changes: Record<string, [unknown, unknown]>
  summary: string
  ip_address: string
  created_at: string
}

export interface FiltrosAuditoria {
  action?: string
  actor?: string
  from?: string
}

export function useLogsAuditoria(filtros: FiltrosAuditoria) {
  const q = new URLSearchParams()
  if (filtros.action) q.set('action', filtros.action)
  if (filtros.actor) q.set('actor', filtros.actor)
  if (filtros.from) q.set('from', filtros.from)
  q.set('limit', '100')
  return useQuery({
    queryKey: ['auditoria', 'logs', filtros],
    queryFn: () => api.get<Paginado<RegistroAuditoria>>(`/api/v1/audit/logs/?${q.toString()}`),
    staleTime: 15_000,
  })
}

export type TipoPedidoLgpd = 'export' | 'anonymize' | 'rectify'
export type StatusPedidoLgpd = 'pending' | 'approved' | 'running' | 'done' | 'failed' | 'rejected'

export interface PedidoLgpd {
  id: number
  kind: TipoPedidoLgpd
  status: StatusPedidoLgpd
  subject_user: number | null
  subject_user_name: string | null
  subject_company: number | null
  subject_company_name: string | null
  requested_by: number | null
  executed_by: number | null
  executed_by_name: string | null
  executed_at: string | null
  verified_by: number | null
  verified_at: string | null
  verification_note: string
  due_at: string | null
  is_overdue: boolean
  days_left: number | null
  has_export: boolean
  result: Record<string, unknown>
  error: string
  notes: string
  rejection_reason: string
  created_at: string
}

export function usePedidosLgpd() {
  return useQuery({
    queryKey: ['auditoria', 'lgpd'],
    queryFn: () => api.get<Paginado<PedidoLgpd>>('/api/v1/audit/lgpd/?limit=100'),
    staleTime: 10_000,
    select: (d) => d.results,
  })
}

function invalidarLgpd(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['auditoria', 'lgpd'] })
}

export function useVerificarPedido(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (verification_note: string) =>
      api.post<PedidoLgpd>(`/api/v1/audit/lgpd/${id}/verify/`, { verification_note }),
    onSuccess: () => invalidarLgpd(qc),
  })
}

export function useRejeitarPedido(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rejection_reason: string) =>
      api.post<PedidoLgpd>(`/api/v1/audit/lgpd/${id}/reject/`, { rejection_reason }),
    onSuccess: () => invalidarLgpd(qc),
  })
}

export function useExecutarPedido(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<PedidoLgpd>(`/api/v1/audit/lgpd/${id}/execute/`),
    onSuccess: () => invalidarLgpd(qc),
  })
}
