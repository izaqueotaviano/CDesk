import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'
import { chaves as chavesChat, type ConfigChat } from '@/api/chat'

function lista<T>(d: Paginado<T> | T[]): T[] {
  return Array.isArray(d) ? d : d.results
}

// ---------------------------------------------------------------------------
// Status (TicketStage) — as colunas do Kanban. Criar um status aqui é criar
// uma coluna lá; é a mesma coisa vista de duas telas (apps/tickets/admin_api.py).
// ---------------------------------------------------------------------------

export type CategoriaStatus = 'new' | 'open' | 'pending_customer' | 'resolved' | 'closed'

export interface Status {
  id: number
  name: string
  slug: string
  category: CategoriaStatus
  category_label: string
  color: string
  order: number
  is_system: boolean
  is_active: boolean
  ticket_count: number
}
export type StatusEscrita = Partial<Pick<Status, 'name' | 'slug' | 'category' | 'color' | 'is_active'>>

export function useStatusList() {
  return useQuery({
    queryKey: ['cfg-status'],
    queryFn: () => api.get<Paginado<Status> | Status[]>('/api/v1/settings/statuses/'),
    select: lista,
    staleTime: 60_000,
  })
}
export function useCriarStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: StatusEscrita & { name: string; category: CategoriaStatus }) =>
      api.post<Status>('/api/v1/settings/statuses/', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-status'] }),
  })
}
export function useAtualizarStatus(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: StatusEscrita) => api.patch<Status>(`/api/v1/settings/statuses/${id}/`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-status'] }),
  })
}

// ---------------------------------------------------------------------------
// Serviços e Categorias — Categoria pertence a um Serviço (opcional).
// ---------------------------------------------------------------------------

export interface Servico {
  id: number
  name: string
  slug: string
  is_active: boolean
  order: number
  category_count: number
}
export type ServicoEscrita = Partial<Pick<Servico, 'name' | 'slug' | 'is_active'>>

export function useServicosCfg() {
  return useQuery({
    queryKey: ['cfg-servicos'],
    queryFn: () => api.get<Paginado<Servico> | Servico[]>('/api/v1/settings/services/'),
    select: lista,
    staleTime: 60_000,
  })
}
export function useCriarServico() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: ServicoEscrita & { name: string }) => api.post<Servico>('/api/v1/settings/services/', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-servicos'] }),
  })
}
export function useAtualizarServico(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: ServicoEscrita) => api.patch<Servico>(`/api/v1/settings/services/${id}/`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-servicos'] }),
  })
}
// Desativar é só um PATCH `is_active: false` via useAtualizarServico — o
// campo é gravável no serializer. Não precisa de um DELETE (que o backend
// também aceita e trata como o mesmo soft-delete, mas seria um segundo
// caminho pro mesmo efeito, sem motivo).

export interface CategoriaCfg {
  id: number
  name: string
  slug: string
  service: number | null
  service_name: string | null
  is_active: boolean
  order: number
  ticket_count: number
}
export type CategoriaCfgEscrita = Partial<Pick<CategoriaCfg, 'name' | 'slug' | 'service' | 'is_active'>>

export function useCategoriasCfg() {
  return useQuery({
    queryKey: ['cfg-categorias'],
    queryFn: () => api.get<Paginado<CategoriaCfg> | CategoriaCfg[]>('/api/v1/settings/categories/'),
    select: lista,
    staleTime: 60_000,
  })
}
export function useCriarCategoriaCfg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: CategoriaCfgEscrita & { name: string }) =>
      api.post<CategoriaCfg>('/api/v1/settings/categories/', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-categorias'] }),
  })
}
export function useAtualizarCategoriaCfg(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: CategoriaCfgEscrita) => api.patch<CategoriaCfg>(`/api/v1/settings/categories/${id}/`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-categorias'] }),
  })
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export interface TagCfg {
  id: number
  name: string
  slug: string
  color: string
}
export type TagCfgEscrita = Partial<Pick<TagCfg, 'name' | 'slug' | 'color'>>

export function useTagsCfg() {
  return useQuery({
    queryKey: ['cfg-tags'],
    queryFn: () => api.get<Paginado<TagCfg> | TagCfg[]>('/api/v1/settings/tags/'),
    select: lista,
    staleTime: 60_000,
  })
}
export function useCriarTagCfg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: TagCfgEscrita & { name: string }) => api.post<TagCfg>('/api/v1/settings/tags/', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-tags'] }),
  })
}
export function useAtualizarTagCfg(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: TagCfgEscrita) => api.patch<TagCfg>(`/api/v1/settings/tags/${id}/`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-tags'] }),
  })
}
export function useExcluirTagCfg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/settings/tags/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-tags'] }),
  })
}

// ---------------------------------------------------------------------------
// Equipes
// ---------------------------------------------------------------------------

// TeamVisibility (apps/accounts/models.py) — só estes dois valores existem.
export type Visibilidade = 'company_wide' | 'requester_only'

export interface EquipeCfg {
  id: number
  name: string
  slug: string
  is_active: boolean
  order: number
  supervisor: number | null
  supervisor_name: string | null
  visibility: Visibilidade
  mask_subject_for_others: boolean
  internal_only: boolean
  chat_calendar: number | null
  notification_email: string
  description: string
  agent_count: number
  ticket_count: number
}
export type EquipeCfgEscrita = Partial<
  Pick<
    EquipeCfg,
    | 'name' | 'slug' | 'is_active' | 'supervisor' | 'visibility'
    | 'mask_subject_for_others' | 'internal_only' | 'chat_calendar'
    | 'notification_email' | 'description'
  >
>

export function useEquipesCfg() {
  return useQuery({
    queryKey: ['cfg-equipes'],
    queryFn: () => api.get<Paginado<EquipeCfg> | EquipeCfg[]>('/api/v1/settings/teams/'),
    select: lista,
    staleTime: 60_000,
  })
}
export function useCriarEquipeCfg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: EquipeCfgEscrita & { name: string }) => api.post<EquipeCfg>('/api/v1/settings/teams/', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-equipes'] }),
  })
}
export function useAtualizarEquipeCfg(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: EquipeCfgEscrita) => api.patch<EquipeCfg>(`/api/v1/settings/teams/${id}/`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-equipes'] }),
  })
}

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

export type LimitPeriod = 'weekly' | 'monthly'

export interface PlanoCfg {
  id: number
  slug: string
  name: string
  description: string
  is_active: boolean
  rank: number
  default_ticket_limit: number | null
  default_limit_period: LimitPeriod
  monthly_maintenance_minutes: number | null
  chat_enabled: boolean
  chat_consumes_quota: boolean
  company_count: number
}
export type PlanoCfgEscrita = Partial<
  Pick<
    PlanoCfg,
    | 'name' | 'slug' | 'description' | 'is_active' | 'rank' | 'default_ticket_limit'
    | 'default_limit_period' | 'monthly_maintenance_minutes' | 'chat_enabled' | 'chat_consumes_quota'
  >
>

export function usePlanosCfg() {
  return useQuery({
    queryKey: ['cfg-planos'],
    queryFn: () => api.get<Paginado<PlanoCfg> | PlanoCfg[]>('/api/v1/settings/plans/'),
    select: lista,
    staleTime: 60_000,
  })
}
export function useCriarPlanoCfg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: PlanoCfgEscrita & { name: string }) => api.post<PlanoCfg>('/api/v1/settings/plans/', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-planos'] }),
  })
}
export function useAtualizarPlanoCfg(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: PlanoCfgEscrita) => api.patch<PlanoCfg>(`/api/v1/settings/plans/${id}/`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-planos'] }),
  })
}

// ---------------------------------------------------------------------------
// SLA — política por par (plano × equipe); mais específico vence.
// ---------------------------------------------------------------------------

export interface SlaPolicyCfg {
  id: number
  name: string
  plan: number | null
  plan_name: string | null
  team: number | null
  team_name: string | null
  first_response_minutes: number
  resolution_minutes: number
  use_business_hours: boolean
  is_active: boolean
}
export type SlaPolicyCfgEscrita = Partial<
  Pick<
    SlaPolicyCfg,
    'name' | 'plan' | 'team' | 'first_response_minutes' | 'resolution_minutes' | 'use_business_hours' | 'is_active'
  >
>

export function useSlaPoliciesCfg() {
  return useQuery({
    queryKey: ['cfg-sla'],
    queryFn: () => api.get<Paginado<SlaPolicyCfg> | SlaPolicyCfg[]>('/api/v1/settings/sla-policies/'),
    select: lista,
    staleTime: 60_000,
  })
}
export function useCriarSlaPolicyCfg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: SlaPolicyCfgEscrita & { name: string; first_response_minutes: number; resolution_minutes: number }) =>
      api.post<SlaPolicyCfg>('/api/v1/settings/sla-policies/', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-sla'] }),
  })
}
export function useAtualizarSlaPolicyCfg(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: SlaPolicyCfgEscrita) => api.patch<SlaPolicyCfg>(`/api/v1/settings/sla-policies/${id}/`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-sla'] }),
  })
}

// ---------------------------------------------------------------------------
// Calendário de expediente + Feriados
// ---------------------------------------------------------------------------

export interface JanelaExpediente {
  weekday: number // 0=segunda .. 6=domingo (confirmar convenção do backend na validação)
  start: string // "HH:MM"
  end: string
}

export interface Feriado {
  id: number
  calendar: number
  date: string
  name: string
  start_time: string | null
  end_time: string | null
}

export interface CalendarioExpediente {
  id: number
  name: string
  timezone: string
  is_default: boolean
  workdays: JanelaExpediente[]
  holidays: Feriado[]
}
export type CalendarioEscrita = Partial<Pick<CalendarioExpediente, 'name' | 'timezone' | 'is_default' | 'workdays'>>

export function useCalendariosCfg() {
  return useQuery({
    queryKey: ['cfg-calendarios'],
    queryFn: () =>
      api.get<Paginado<CalendarioExpediente> | CalendarioExpediente[]>('/api/v1/settings/calendars/'),
    select: lista,
    staleTime: 60_000,
  })
}
export function useCriarCalendarioCfg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: CalendarioEscrita & { name: string; timezone: string }) =>
      api.post<CalendarioExpediente>('/api/v1/settings/calendars/', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-calendarios'] }),
  })
}
export function useAtualizarCalendarioCfg(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: CalendarioEscrita) =>
      api.patch<CalendarioExpediente>(`/api/v1/settings/calendars/${id}/`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-calendarios'] }),
  })
}
export function useExcluirCalendarioCfg() {
  const qc = useQueryClient()
  return useMutation({
    // Sem soft-delete aqui: `BusinessCalendarViewSet` é um ModelViewSet puro
    // (sem `perform_destroy` custom) e as duas FKs que apontam pra cá
    // (`Company.business_calendar`, `Team.chat_calendar`) são SET_NULL — a
    // exclusão é real e quem usava o calendário passa a não ter nenhum.
    mutationFn: (id: number) => api.delete(`/api/v1/settings/calendars/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-calendarios'] }),
  })
}
export function useCriarFeriado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: { calendar: number; date: string; name: string; start_time?: string; end_time?: string }) =>
      api.post<Feriado>('/api/v1/settings/holidays/', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-calendarios'] }),
  })
}
export function useExcluirFeriado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/settings/holidays/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-calendarios'] }),
  })
}

// ---------------------------------------------------------------------------
// Papéis (RBAC) — CustomRole + o catálogo de choices que a tela monta em cima.
// ---------------------------------------------------------------------------

export interface PermissaoCatalogo {
  value: string
  label: string
  group: string
}
export interface OpcaoRotulada {
  value: string
  label: string
}
export interface ChoicesCfg {
  internal_roles: OpcaoRotulada[]
  client_roles: OpcaoRotulada[]
  user_kinds: OpcaoRotulada[]
  permissions: PermissaoCatalogo[]
  ticket_scopes: OpcaoRotulada[]
  role_permissions: Record<string, string[]>
  // Escopo padrão de cada papel embutido (ver `rbac.ROLE_DEFAULT_SCOPE`) —
  // alimenta a dica "em branco, usa X" no formulário de papel personalizado.
  role_default_scopes: Record<string, string>
}

export function useChoicesCfg() {
  return useQuery({
    queryKey: ['cfg-choices'],
    queryFn: () => api.get<ChoicesCfg>('/api/v1/settings/choices/'),
    staleTime: 300_000,
  })
}

export interface PapelCfg {
  id: number
  name: string
  slug: string
  description: string
  base_role: string
  permissions: string[]
  ticket_scope: string
  is_active: boolean
  user_count: number
}
export type PapelCfgEscrita = Partial<
  Pick<PapelCfg, 'name' | 'slug' | 'description' | 'base_role' | 'permissions' | 'ticket_scope' | 'is_active'>
>

export function usePapeisCfg() {
  return useQuery({
    queryKey: ['cfg-papeis'],
    queryFn: () => api.get<Paginado<PapelCfg> | PapelCfg[]>('/api/v1/settings/roles/'),
    select: lista,
    staleTime: 60_000,
  })
}
export function useCriarPapelCfg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: PapelCfgEscrita & { name: string; base_role: string }) =>
      api.post<PapelCfg>('/api/v1/settings/roles/', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-papeis'] }),
  })
}
export function useAtualizarPapelCfg(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: PapelCfgEscrita) => api.patch<PapelCfg>(`/api/v1/settings/roles/${id}/`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-papeis'] }),
  })
}
export function useExcluirPapelCfg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/settings/roles/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-papeis'] }),
  })
}

// ---------------------------------------------------------------------------
// Sistema — singleton (SystemConfig.load()), sem lista nem id.
// ---------------------------------------------------------------------------

export interface SistemaCfg {
  attachment_max_bytes: number
  attachment_max_mb: number
  attachment_max_files_per_message: number
  attachment_max_bytes_per_message: number
  attachment_max_mb_per_message: number
  auto_close_pending_hours: number | null
  auto_close_message: string
  auto_close_warning_hours: number | null
  auto_close_warning_message: string
  csat_enabled: boolean
  csat_expires_days: number
  /** Exigir verificação em duas etapas de todos (senão é opcional por conta). */
  two_factor_required: boolean
  // entrega de e-mail — a senha nunca volta; `smtp_password_set` diz se há uma
  email_enabled: boolean
  smtp_host: string
  smtp_port: number
  smtp_username: string
  smtp_password_set: boolean
  smtp_use_tls: boolean
  smtp_use_ssl: boolean
  email_from: string
  email_html_template: string
  /** O modelo de fábrica, para o botão "restaurar padrão". */
  email_html_template_default: string
  updated_at: string
}
export type SistemaCfgEscrita = Partial<
  Pick<
    SistemaCfg,
    | 'attachment_max_bytes' | 'attachment_max_files_per_message' | 'attachment_max_bytes_per_message'
    | 'auto_close_pending_hours' | 'auto_close_message' | 'auto_close_warning_hours'
    | 'auto_close_warning_message' | 'csat_enabled' | 'csat_expires_days' | 'two_factor_required'
    | 'email_enabled' | 'smtp_host' | 'smtp_port' | 'smtp_username' | 'smtp_use_tls' | 'smtp_use_ssl'
    | 'email_from' | 'email_html_template'
  > & { smtp_password: string }
>

export function useSistemaCfg() {
  return useQuery({
    queryKey: ['cfg-sistema'],
    queryFn: () => api.get<SistemaCfg>('/api/v1/settings/system/'),
    staleTime: 60_000,
  })
}
export function useAtualizarSistemaCfg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: SistemaCfgEscrita) => api.put<SistemaCfg>('/api/v1/settings/system/', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-sistema'] }),
  })
}
/** Manda um e-mail agora pela configuração SALVA — o jeito de conferir o SMTP
 *  antes de um cliente ficar sem código de login. O erro do servidor de
 *  e-mail volta em `detail`. */
export function useEnviarEmailTeste() {
  return useMutation({
    mutationFn: (to: string) => api.post<{ sent: true; to: string }>('/api/v1/settings/system/test-email/', { to }),
  })
}

// ---------------------------------------------------------------------------
// Moderação do chat (BannedWord) — a palavra vira **** na EXIBIÇÃO, para os
// dois lados; o banco guarda o original, então a lista vale retroativamente
// (apps/chat/models.py). Só lista/cria/apaga: não existe "editar" — corrigir
// uma palavra é apagar e cadastrar de novo.
// ---------------------------------------------------------------------------

export interface PalavraBanida {
  id: number
  word: string
}

export function usePalavrasBanidas() {
  return useQuery({
    queryKey: ['cfg-moderacao'],
    queryFn: () => api.get<Paginado<PalavraBanida> | PalavraBanida[]>('/api/v1/chat/banned-words/?limit=500'),
    select: lista,
    staleTime: 60_000,
  })
}
export function useCriarPalavraBanida() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (word: string) => api.post<PalavraBanida>('/api/v1/chat/banned-words/', { word }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-moderacao'] }),
  })
}
export function useExcluirPalavraBanida() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/chat/banned-words/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfg-moderacao'] }),
  })
}

// ---------------------------------------------------------------------------
// Tela de login (marca): textos e imagem do painel, por público. A leitura
// pública é `@/api/branding`; aqui é a escrita do admin.
// ---------------------------------------------------------------------------

import type { MarcaLogin, MarcaLoginEscrita, PublicoLogin } from '@/api/branding'
import { chaveMarcaLogin } from '@/api/branding'

export interface MarcaLoginAdmin {
  cliente: MarcaLogin
  equipe: MarcaLogin
  defaults: Record<PublicoLogin, Pick<MarcaLogin, 'brand_name' | 'headline' | 'subtitle' | 'highlights'>>
}

export function useMarcaLoginAdmin() {
  return useQuery({
    queryKey: ['cfg-marca-login'],
    queryFn: () => api.get<MarcaLoginAdmin>('/api/v1/settings/branding/login/'),
    staleTime: 60_000,
  })
}

function useInvalidarMarca() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['cfg-marca-login'] })
    qc.invalidateQueries({ queryKey: chaveMarcaLogin })
  }
}

export function useAtualizarMarcaLogin(publico: PublicoLogin) {
  const invalidar = useInvalidarMarca()
  return useMutation({
    mutationFn: (d: MarcaLoginEscrita) => api.put<MarcaLogin>(`/api/v1/settings/branding/login/${publico}/`, d),
    onSuccess: invalidar,
  })
}

export function useEnviarImagemMarca(publico: PublicoLogin) {
  const invalidar = useInvalidarMarca()
  return useMutation({
    mutationFn: (arquivo: File) => {
      const fd = new FormData()
      fd.append('file', arquivo)
      return api.post<MarcaLogin>(`/api/v1/settings/branding/login/${publico}/image/`, fd)
    },
    onSuccess: invalidar,
  })
}

export function useRemoverImagemMarca(publico: PublicoLogin) {
  const invalidar = useInvalidarMarca()
  return useMutation({
    mutationFn: () => api.delete<MarcaLogin>(`/api/v1/settings/branding/login/${publico}/image/`),
    onSuccess: invalidar,
  })
}

// ---------------------------------------------------------------------------
// Chat (ChatConfig, singleton) — GET/PUT /api/v1/chat/config/. A LEITURA é a
// mesma do console e do mini chat (`useConfigChat`, chave `chaves.config` em
// @/api/chat): salvar aqui atualiza o teto de atendimentos que eles mostram
// sem F5. Só admin escreve (a view recusa o resto com 403).
// ---------------------------------------------------------------------------

export type ChatCfgEscrita = Partial<{
  welcome_message: string
  queue_timeout_minutes: number
  max_chats_per_agent: number
  score_min: number
  score_max: number
  low_score_threshold: number
  default_team: number | null
}>

export function useAtualizarChatCfg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: ChatCfgEscrita) => api.put<ConfigChat>('/api/v1/chat/config/', d),
    onSuccess: (config) => {
      qc.setQueryData(chavesChat.config, config)
      qc.invalidateQueries({ queryKey: chavesChat.config })
    },
  })
}
