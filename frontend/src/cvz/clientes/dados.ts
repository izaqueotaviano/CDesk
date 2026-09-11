import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  /** Segundo contato. Vem junto de `phone` porque a exigência do backend é
   *  "pelo menos um dos dois" — ler só o primeiro esconderia metade da regra. */
  phone_secondary: string
  is_active: boolean
  /** '' | 'pendente' | 'aceito' — em PORTUGUÊS (`UserAdminSerializer.get_invite_status`).
   *  Cliente sempre depende de senha, então nunca vem vazio aqui. */
  invite_status: string
  last_login: string | null
  last_seen_at: string | null
}

/** Cadastro de um usuário de cliente — recorte de escrita de
 *  `UserAdminSerializer` (apps/accounts/admin_api.py).
 *
 *  `kind`, `company` e `internal_role` NÃO entram de propósito: quem cria é a
 *  rota da empresa, que os fixa a partir da URL e ignora o que vier no corpo.
 *
 *  Telefone: o serializer exige PELO MENOS UM entre `phone` e
 *  `phone_secondary` quando `kind` é cliente — nenhum dos dois é obrigatório
 *  sozinho. Por isso os dois são opcionais aqui: quem valida "ao menos um" é
 *  o formulário, com a mesma regra do servidor. */
export interface UsuarioClienteEscrita {
  full_name: string
  email: string
  client_role: ClientRole
  job_title?: string
  phone?: string
  phone_secondary?: string
}

/** Edição de um usuário já criado. `email` fica de fora: é a identidade de
 *  login e o destino do convite — trocá-la no meio de um formulário de
 *  cadastro é mudar de pessoa sem parecer que mudou. */
export type UsuarioClienteEdicao = Partial<Omit<UsuarioClienteEscrita, 'email'>> & {
  is_active?: boolean
}

export interface ParamsListaEmpresas {
  q?: string
  is_active?: boolean
  limit: number
  offset: number
}

function montarQuery(p: ParamsListaEmpresas): string {
  const q = new URLSearchParams()
  if (p.q) q.set('q', p.q)
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
    // evita o pisca-branco ao trocar de página/busca — a tabela antiga fica
    // visível enquanto a nova página carrega (mesmo padrão da fila de tickets)
    placeholderData: keepPreviousData,
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
    mutationFn: (dados: UsuarioClienteEscrita) =>
      api.post<UsuarioCliente>(`/api/v1/settings/companies/${empresaId}/users/`, dados),
    // Invalida a chave da EMPRESA inteira (prefixo), não só a lista de
    // usuários: `user_count` sai do detalhe da empresa e ficava velho no
    // cabeçalho depois de convidar alguém.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['empresa', empresaId] }),
  })
}

/** Edição do cadastro de um usuário de cliente.
 *
 *  A rota é a PLANA (`settings/users/<id>/`, `UserAdminViewSet`) e não uma
 *  sub-rota da empresa: a que fica sob a empresa só lista e cria — não existe
 *  PATCH lá. `empresaId` entra só para saber qual lista invalidar. */
export function useAtualizarUsuario(empresaId: number, usuarioId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: UsuarioClienteEdicao) =>
      api.patch<UsuarioCliente>(`/api/v1/settings/users/${usuarioId}/`, dados),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['empresa', empresaId, 'usuarios'] }),
  })
}

// --------------------------------------------------------------------------
// Chat embutido (embed-widget) — `@action`s de CompanyAdminViewSet,
// apps/customers/admin_api.py. Não é aparência (cor/saudação/posição): não
// existe nenhum campo de tema no backend — é liga/desliga por empresa,
// origens autorizadas a exibir o iframe (CSP) e a chave que o site do
// cliente usa pra assinar a sessão.
// --------------------------------------------------------------------------

export interface ChatEmbed {
  enabled: boolean
  /** Modo público: um código só pro site inteiro, sem assinatura por pessoa. */
  public_enabled: boolean
  /** `scheme://host[:porta]`, sem caminho — normalizado pelo backend (minúsculo, sem barra final). */
  origins: string[]
  rotated_at: string
  company_slug: string
  /** O código de instalação, montado pelo backend (é ele que sabe o endereço
   *  público desta instalação — a SPA pode estar noutro domínio). UM por
   *  empresa: nada de pessoa entra aqui. */
  snippet: string
  /** Endereço do iframe, pra quem prefere embutir na mão em vez do loader. */
  iframe_url: string
}

export function useChatEmbed(empresaId: number, habilitado: boolean) {
  return useQuery({
    queryKey: ['empresa', empresaId, 'chat-embed'],
    queryFn: () => api.get<ChatEmbed>(`/api/v1/settings/companies/${empresaId}/chat-embed/`),
    enabled: habilitado && Number.isFinite(empresaId),
  })
}

export function useAtualizarChatEmbed(empresaId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: { enabled?: boolean; public_enabled?: boolean; origins?: string[] }) =>
      api.patch<ChatEmbed>(`/api/v1/settings/companies/${empresaId}/chat-embed/`, dados),
    onSuccess: (embed) => qc.setQueryData(['empresa', empresaId, 'chat-embed'], embed),
  })
}

/** A chave crua só sai AQUI, uma vez — a leitura (`useChatEmbed`) nunca a devolve. */
export function useRegenerarSegredoChatEmbed(empresaId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ secret: string }>(`/api/v1/settings/companies/${empresaId}/chat-embed/regenerate-secret/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['empresa', empresaId, 'chat-embed'] }),
  })
}
