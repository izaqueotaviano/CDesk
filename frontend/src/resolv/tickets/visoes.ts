/**
 * As visões do SISTEMA da fila — recortes nomeados definidos no servidor
 * (`SAVED_VIEWS`/`_apply_saved_view` em apps/tickets/views.py), iguais para
 * todo mundo. Uma lista só, lida pelo painel lateral, pela folha de visões
 * do celular e pelo título da página: antes o rótulo vivia duplicado no
 * painel e na página, e os dois podiam divergir.
 *
 * As visões PESSOAIS (as que a pessoa salva) vêm do servidor
 * (`useVisoesPessoais`) e não moram aqui.
 */
export interface Visualizacao {
  id: string
  label: string
  /** valor de ?view= no servidor */
  view: string
  /** Prioridade implícita — "Tickets prioritários" é `nao-resolvidos` +
   *  urgente, não uma visão salva do servidor (não tem contagem no resumo). */
  prioridade?: string
}

export const VISOES_DO_SISTEMA: Visualizacao[] = [
  { id: 'meus-nao-resolvidos', label: 'Meus tickets não resolvidos', view: 'meus-nao-resolvidos' },
  // Separa o que está na SUA mão do que espera o cliente — "Meus tickets não
  // resolvidos" mistura os dois, e são coisas opostas na hora de trabalhar.
  // A definição é do servidor (meu, não fechado, e o último a falar não fui eu).
  { id: 'aguardando-voce', label: 'Aguardando você', view: 'aguardando-voce' },
  // Menção só nasce da marcação `@[user:N]` numa nota interna
  // (apps/tickets/services/mentions.py). A gaveta ficava escondida enquanto
  // nenhuma tela sabia escrever essa marcação; o compositor do detalhe
  // ganhou o autocomplete de `@`, e com ele a gaveta passa a ter conteúdo.
  { id: 'mencionam-voce', label: 'Mencionam você', view: 'mencionam-voce' },
  { id: 'todos', label: 'Todos os tickets', view: 'todos' },
  {
    id: 'prioritario',
    label: 'Tickets prioritários',
    view: 'nao-resolvidos',
    prioridade: 'urgent',
  },
  { id: 'sem-atendimento', label: 'Tickets sem atendimento', view: 'sem-atendimento' },
  { id: 'nao-resolvidos', label: 'Todos os tickets não resolvidos', view: 'nao-resolvidos' },
  // O filtro real do servidor é `cards__due_at__isnull=False` — "tem prazo
  // interno anotado no quadro" —, não "está no kanban" (todo ticket visível
  // está no quadro). Daí o rótulo.
  { id: 'em-kanban', label: 'Com prazo no quadro', view: 'em-kanban' },
  { id: 'nao-atribuidos', label: 'Tickets não atribuídos', view: 'nao-atribuidos' },
  { id: 'resolvidos', label: 'Tickets resolvidos', view: 'resolvidos' },
  { id: 'internos', label: 'Tickets internos', view: 'internos' },
]

export const VISAO_INICIAL = 'nao-resolvidos'

const POR_ID = new Map(VISOES_DO_SISTEMA.map((v) => [v.id, v]))

export function visaoDoSistema(id: string | null | undefined): Visualizacao | undefined {
  return id ? POR_ID.get(id) : undefined
}
