import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'

export type TipoAviso = 'info' | 'urgent' | 'holiday' | 'vacation'
export type TipoAudiencia = 'all' | 'all_internal' | 'all_clients' | 'teams' | 'roles' | 'companies' | 'plans'

export interface Aviso {
  id: number
  title: string
  body: string
  kind: TipoAviso
  starts_at: string
  ends_at: string | null
  is_pinned: boolean
  is_active: boolean
  audience_kind: TipoAudiencia
  target_roles: string[]
  target_teams: number[]
  target_companies: number[]
  target_plans: number[]
  created_by_name: string | null
  dismissed: boolean
  created_at: string
}

/** O que se manda pro `POST`/`PATCH` — o mesmo shape de leitura, sem os
 *  campos calculados (`id`, `created_by_name`, `dismissed`, `created_at`). */
export type AvisoEscrita = Partial<
  Pick<
    Aviso,
    | 'title' | 'body' | 'kind' | 'starts_at' | 'ends_at' | 'is_pinned' | 'is_active'
    | 'audience_kind' | 'target_roles' | 'target_teams' | 'target_companies' | 'target_plans'
  >
>

export const ROTULO_TIPO: Record<TipoAviso, string> = {
  info: 'Informativo',
  urgent: 'Urgente',
  holiday: 'Feriado',
  vacation: 'Férias da equipe',
}

export const ROTULO_AUDIENCIA: Record<TipoAudiencia, string> = {
  all: 'Todos',
  all_internal: 'Todos os internos',
  all_clients: 'Todos os clientes',
  teams: 'Equipes específicas',
  roles: 'Papéis específicos',
  companies: 'Empresas específicas',
  plans: 'Planos específicos',
}

export const ROTULO_PAPEL: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  agent: 'Agente',
  light_agent: 'Agente leve',
}

const chaves = {
  gerenciar: (historico: boolean) => ['avisos', 'gerenciar', historico] as const,
}

/** Visão de administração: TODOS os avisos (qualquer audiência), com ou sem
 *  o histórico (desativados/expirados) — `?manage=1[&history=1]`. */
export function useAvisosGerenciar(historico: boolean) {
  return useQuery({
    queryKey: chaves.gerenciar(historico),
    queryFn: () =>
      api.get<Paginado<Aviso>>(`/api/v1/announcements/?manage=1${historico ? '&history=1' : ''}&limit=200`),
    staleTime: 10_000,
    select: (d) => d.results,
  })
}

function invalidarAvisos(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['avisos'] })
}

export function useCriarAviso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: AvisoEscrita) => api.post<Aviso>('/api/v1/announcements/', dados),
    onSuccess: () => invalidarAvisos(qc),
  })
}

export function useAtualizarAviso(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: AvisoEscrita) => api.patch<Aviso>(`/api/v1/announcements/${id}/`, dados),
    onSuccess: () => invalidarAvisos(qc),
  })
}

/** "Apagar" na API é desativar (`is_active=False`) — histórico nunca some. */
export function useDesativarAviso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/v1/announcements/${id}/`),
    onSuccess: () => invalidarAvisos(qc),
  })
}
