import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'

/** `TicketPriority` (apps/tickets/models.py) — os rótulos são os do backend. */
export const PRIORIDADES = [
  { value: 'low', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
] as const

export type Prioridade = (typeof PRIORIDADES)[number]['value']

/** `TeamSerializer` (apps/tickets/serializers.py). */
export interface Equipe {
  id: number
  name: string
  slug: string
  visibility: string
  order: number
}

/** `ServiceSerializer` — o nível acima de categoria. */
export interface Servico {
  id: number
  name: string
  slug: string
  order: number
}

/** `TicketCategorySerializer`; `service` é o id do serviço (pode ser null). */
export interface Categoria {
  id: number
  name: string
  slug: string
  service: number | null
  order: number
}

/** `CompanySerializer` público (apps/customers/views.py) — só leitura. */
export interface EmpresaOpcao {
  id: number
  name: string
  slug: string
  plan_name: string
  is_active: boolean
}

/** `UserSerializer` (apps/accounts/views.py). */
export interface UsuarioDiretorio {
  id: number
  full_name: string
  email: string
  kind: string
  internal_role: string | null
  company: number | null
  presence: string
}

/** `TicketTagPillSerializer` — cadastro em `GET /api/v1/settings/tags/`. */
export interface Etiqueta {
  id: number
  name: string
  slug: string
  color: string
}

/** `TicketMacroSerializer` (apps/tickets/admin_api.py). */
export interface MacroTicket {
  id: number
  name: string
  body: string
  category: number | null
  priority: Prioridade | '' | null
  assignee: number | null
  tags: number[]
  is_active: boolean
  order: number
}

/** `GET /api/v1/tickets/response-estimate/?team=<slug>` — média histórica de
 *  primeira resposta. NÃO é prazo prometido (o SLA é outra coisa). */
export interface EstimativaResposta {
  minutes: number | null
  sample: number
  /** `null` quando ainda não há histórico suficiente — nesse caso a tela não
   *  mostra estimativa nenhuma, em vez de inventar um número. */
  label: string | null
}

/**
 * Corpo do POST /api/v1/tickets/ mais o que só dá para aplicar DEPOIS.
 *
 * O `TicketCreateSerializer` aceita só team/subject/body/priority/
 * order_number/category/requester (+ `files` multipart). Responsável e tags
 * existem no ticket, mas nenhum dos dois entra na criação — por isso viajam
 * aqui separados e viram uma segunda chamada em `useAbrirTicket`.
 */
export interface NovoTicket {
  team_id: number
  subject: string
  body: string
  priority: Prioridade
  /** Obrigatório para usuário interno (views.py:create) — o cliente em nome de quem se abre. */
  requester_id: number
  category_id?: number | null
  order_number?: string
  arquivos?: File[]
  /** Aplicado depois via `POST /tickets/{id}/assign/`. */
  assignee_id?: number | null
  /** Aplicado depois via `PATCH /tickets/{id}/` (a lista SUBSTITUI o conjunto). */
  tag_ids?: number[]
}

/** O POST devolve o TicketDetail inteiro; aqui só o que a navegação precisa. */
interface TicketCriado {
  id: number
  reference: string
}

/**
 * O chamado sempre é criado; `pendencias` diz o que das etapas seguintes não
 * colou. Isso não é detalhe de implementação escondido: se a atribuição falhar,
 * a pessoa precisa saber que o chamado existe mas está sem responsável — em
 * vez de ver um erro genérico e abrir um segundo chamado igual.
 */
export interface ResultadoAbertura {
  ticket: TicketCriado
  pendencias: string[]
}

/** Lista paginada ou array cru — os ReadOnlyModelViewSets variam conforme a
 *  paginação padrão estar ativa ou não; normaliza aqui e ninguém mais pensa nisso. */
function lista<T>(d: Paginado<T> | T[]): T[] {
  return Array.isArray(d) ? d : d.results
}

export function useEquipes() {
  return useQuery({
    queryKey: ['equipes'],
    queryFn: () => api.get<Paginado<Equipe> | Equipe[]>('/api/v1/teams/'),
    staleTime: 300_000,
    select: lista,
  })
}

export function useServicos() {
  return useQuery({
    queryKey: ['servicos'],
    queryFn: () => api.get<Paginado<Servico> | Servico[]>('/api/v1/services/'),
    staleTime: 300_000,
    select: lista,
  })
}

export function useCategorias() {
  return useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get<Paginado<Categoria> | Categoria[]>('/api/v1/categories/'),
    staleTime: 300_000,
    select: lista,
  })
}

export function useEmpresasOpcoes() {
  return useQuery({
    queryKey: ['empresas-opcoes'],
    queryFn: () => api.get<Paginado<EmpresaOpcao> | EmpresaOpcao[]>('/api/v1/companies/'),
    staleTime: 300_000,
    select: (d: Paginado<EmpresaOpcao> | EmpresaOpcao[]) =>
      lista(d).filter((e) => e.is_active),
  })
}

/**
 * Usuários CLIENTE do diretório. `?kind=client` e `?company=` são filtros que
 * o próprio backend expõe (UserViewSet.get_queryset) — filtrar no servidor
 * mantém a lista curta quando a base cresce, em vez de trazer tudo e cortar aqui.
 */
export function useClientes(empresaId: number | null) {
  const params = new URLSearchParams({ kind: 'client' })
  if (empresaId != null) params.set('company', String(empresaId))
  return useQuery({
    queryKey: ['clientes', empresaId],
    queryFn: () =>
      api.get<Paginado<UsuarioDiretorio> | UsuarioDiretorio[]>(
        `/api/v1/users/?${params.toString()}`,
      ),
    staleTime: 60_000,
    select: lista,
  })
}

/** Agentes internos — alimenta o seletor de responsável. Sem `?kind=client`,
 *  o UserViewSet devolve exatamente os internos ativos. */
export function useAgentes() {
  return useQuery({
    queryKey: ['agentes'],
    queryFn: () => api.get<Paginado<UsuarioDiretorio> | UsuarioDiretorio[]>('/api/v1/users/'),
    staleTime: 300_000,
    select: lista,
  })
}

export function useEtiquetas() {
  return useQuery({
    queryKey: ['etiquetas'],
    queryFn: () => api.get<Paginado<Etiqueta> | Etiqueta[]>('/api/v1/settings/tags/'),
    staleTime: 300_000,
    select: lista,
  })
}

export function useMacrosTicket() {
  return useQuery({
    queryKey: ['macros-ticket'],
    queryFn: () =>
      api.get<Paginado<MacroTicket> | MacroTicket[]>('/api/v1/settings/ticket-macros/'),
    staleTime: 300_000,
    select: (d: Paginado<MacroTicket> | MacroTicket[]) => lista(d).filter((m) => m.is_active),
  })
}

/**
 * Média histórica de primeira resposta da equipe. O prazo de SLA é calculado
 * pelo servidor no momento da criação e não aceita palpite do front — então o
 * que dá para mostrar antes de abrir é esta média, e ela é rotulada como
 * média, nunca como promessa.
 */
export function useEstimativaResposta(equipeSlug: string | null) {
  return useQuery({
    queryKey: ['estimativa-resposta', equipeSlug],
    queryFn: () =>
      api.get<EstimativaResposta>(`/api/v1/tickets/response-estimate/?team=${equipeSlug}`),
    enabled: !!equipeSlug,
    staleTime: 300_000,
  })
}

/**
 * Abre o chamado. Com anexo vira multipart (o backend lê `request.FILES
 * .getlist("files")` e prende os arquivos na PRIMEIRA mensagem); sem anexo
 * segue JSON, que é o caminho comum.
 *
 * Responsável e tags saem em chamadas separadas DEPOIS da criação, porque o
 * `TicketCreateSerializer` não os aceita. Se uma delas falhar, o chamado já
 * existe: o erro vira `pendencias` em vez de derrubar a operação inteira.
 */
export function useAbrirTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      arquivos,
      assignee_id,
      tag_ids,
      ...dados
    }: NovoTicket): Promise<ResultadoAbertura> => {
      let ticket: TicketCriado
      if (!arquivos?.length) {
        ticket = await api.post<TicketCriado>('/api/v1/tickets/', dados)
      } else {
        const form = new FormData()
        form.append('team_id', String(dados.team_id))
        form.append('subject', dados.subject)
        form.append('body', dados.body)
        form.append('priority', dados.priority)
        form.append('requester_id', String(dados.requester_id))
        if (dados.category_id != null) form.append('category_id', String(dados.category_id))
        if (dados.order_number) form.append('order_number', dados.order_number)
        arquivos.forEach((f) => form.append('files', f))
        ticket = await api.post<TicketCriado>('/api/v1/tickets/', form)
      }

      const pendencias: string[] = []

      if (assignee_id != null) {
        try {
          await api.post(`/api/v1/tickets/${ticket.id}/assign/`, { assignee_id })
        } catch {
          pendencias.push('o responsável não foi atribuído')
        }
      }

      if (tag_ids?.length) {
        try {
          await api.patch(`/api/v1/tickets/${ticket.id}/`, { tags: tag_ids })
        } catch {
          pendencias.push('as tags não foram aplicadas')
        }
      }

      return { ticket, pendencias }
    },
    onSuccess: () => {
      // a fila (['tickets','lista',…]) e os cartões da home (['kpi',…]) mudaram
      // com o chamado novo, e nenhum dos dois descobre isso sozinho
      qc.invalidateQueries({ queryKey: ['tickets'] })
      qc.invalidateQueries({ queryKey: ['kpi'] })
    },
  })
}
