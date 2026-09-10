import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'

export type LimitPeriod = 'weekly' | 'monthly'
export type LimitScope = 'company' | 'user'
export type ClientRole = 'owner' | 'member'

export interface UsoPeriodo {
  used: number
  limit: number | null
  period_start: string
  period_end: string
}

export interface UsoManutencao {
  used_minutes: number
  limit_minutes: number | null
  period_start: string
  period_end: string
}

/** Recorte real do `CompanyAdminSerializer` (apps/customers/admin_api.py). */
export interface Empresa {
  id: number
  name: string
  legal_name: string
  tax_id: string | null
  slug: string
  plan: number
  plan_name: string
  is_active: boolean
  ticket_limit: number | null
  limit_period: LimitPeriod | '' | null
  limit_scope: LimitScope
  timezone: string
  business_calendar: number | null
  account_manager: number | null
  contract_started_at: string | null
  contract_ended_at: string | null
  notes: string
  domains: string[]
  user_count: number
  effective_limit: number | null
  effective_period: LimitPeriod | ''
  quota_usage: UsoPeriodo
  maintenance_minutes: number | null
  effective_maintenance_minutes: number | null
  maintenance_usage: UsoManutencao
}

/** Payload de escrita — todo campo é opcional (PATCH parcial); `EmpresaForm`
 *  no create manda os obrigatórios de verdade (name, plan, slug). */
export type EmpresaEscrita = Partial<
  Pick<
    Empresa,
    | 'name'
    | 'legal_name'
    | 'tax_id'
    | 'slug'
    | 'plan'
    | 'is_active'
    | 'timezone'
    | 'ticket_limit'
    | 'limit_period'
    | 'notes'
    | 'domains'
    | 'contract_started_at'
    | 'contract_ended_at'
  >
>

export interface Plano {
  id: number
  slug: string
  name: string
  is_active: boolean
  rank: number
}

export interface UsuarioCliente {
  id: number
  email: string
  full_name: string
  client_role: ClientRole | '' | null
  job_title: string
  phone: string
  is_active: boolean
  invite_status: string
  last_login: string | null
  last_seen_at: string | null
}

export interface ParamsListaEmpresas {
  q?: string
  is_active?: boolean
  limit: number
  offset: number
}

function montarQuery(p: ParamsListaEmpresas): string {
  const q = new URLSearchParams()
  // A API admin não documenta busca textual própria — filtragem por nome
  // roda no cliente sobre a página carregada (ver useEmpresas). `is_active`
  // e paginação são os únicos parâmetros reais que valem mandar ao servidor.
  if (p.is_active !== undefined) q.set('is_active', String(p.is_active))
  q.set('limit', String(p.limit))
  q.set('offset', String(p.offset))
  return q.toString()
}

export function useEmpresas(params: ParamsListaEmpresas) {
  return useQuery({
    queryKey: ['empresas', params],
    queryFn: () => api.get<Paginado<Empresa>>(`/api/v1/settings/companies/?${montarQuery(params)}`),
    staleTime: 15_000,
  })
}

export function useEmpresa(id: number) {
  return useQuery({
    queryKey: ['empresa', id],
    queryFn: () => api.get<Empresa>(`/api/v1/settings/companies/${id}/`),
    enabled: Number.isFinite(id),
  })
}

export function usePlanos() {
  return useQuery({
    queryKey: ['planos'],
    queryFn: () => api.get<Paginado<Plano> | Plano[]>('/api/v1/settings/plans/'),
    staleTime: 300_000,
    select: (d) => (Array.isArray(d) ? d : d.results).filter((p) => p.is_active),
  })
}

export function useUsuariosDaEmpresa(empresaId: number, habilitado: boolean) {
  return useQuery({
    queryKey: ['empresa', empresaId, 'usuarios'],
    queryFn: () => api.get<UsuarioCliente[]>(`/api/v1/settings/companies/${empresaId}/users/`),
    enabled: habilitado && Number.isFinite(empresaId),
  })
}

export function useCriarEmpresa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: EmpresaEscrita & { name: string; plan: number }) =>
      api.post<Empresa>('/api/v1/settings/companies/', dados),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['empresas'] }),
  })
}

export function useAtualizarEmpresa(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: EmpresaEscrita) => api.patch<Empresa>(`/api/v1/settings/companies/${id}/`, dados),
    onSuccess: (empresa) => {
      qc.setQueryData(['empresa', id], empresa)
      qc.invalidateQueries({ queryKey: ['empresas'] })
    },
  })
}

export function useConvidarUsuario(empresaId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: { email: string; full_name: string; client_role: ClientRole }) =>
      api.post<UsuarioCliente>(`/api/v1/settings/companies/${empresaId}/users/`, dados),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['empresa', empresaId, 'usuarios'] }),
  })
}
