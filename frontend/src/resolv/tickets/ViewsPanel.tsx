/**
 * Painel do agente — as "visualizações salvas" da lateral do print. Cada uma
 * aponta para um `?view=` REAL do backend (o parâmetro `view` do
 * /api/v1/tickets/ tem exatamente estes valores). As duas do rodapé
 * ("Next Store", "Mix Lar") são visualizações personalizadas por empresa no
 * sistema antigo — sem endpoint de saved-views ainda, ficam como placeholder
 * honesto (inertes), não como link quebrado.
 */
export interface Visualizacao {
  id: string
  label: string
  /** valor de ?view= (ou undefined para as inertes) */
  view?: string
  priorityOnly?: boolean
}

const VIEWS: Visualizacao[] = [
  { id: 'meus-nao-resolvidos', label: 'Meus tickets não resolvidos', view: 'meus-nao-resolvidos' },
  { id: 'todos', label: 'Todos os tickets', view: 'todos' },
  { id: 'prioritario', label: 'Tickets Prioritário', priorityOnly: true },
  { id: 'sem-atendimento', label: 'Tickets Sem Atendimento', view: 'sem-atendimento' },
  { id: 'nao-resolvidos', label: 'Todos os tickets não resolvidos', view: 'nao-resolvidos' },
  { id: 'em-kanban', label: 'Todos os tickets - Kanban', view: 'em-kanban' },
  { id: 'nao-atribuidos', label: 'Tickets não atribuídos', view: 'nao-atribuidos' },
  { id: 'resolvidos', label: 'Tickets Resolvidos', view: 'resolvidos' },
  { id: 'internos', label: 'Tickets Internos', view: 'internos' },
]

const PESSOAIS: Visualizacao[] = [
  { id: 'next-store', label: 'Next Store' },
  { id: 'mix-lar', label: 'Mix Lar' },
]

export function ViewsPanel({
  ativa,
  onSelecionar,
}: {
  ativa: string
  onSelecionar: (v: Visualizacao) => void
}) {
  return (
    <aside className="lista-tickets__views" aria-label="Visualizações">
      <div className="views-panel__busca">
        <i className="ti ti-search" />
        <input type="text" placeholder="Painel do agente" aria-label="Filtrar visualizações" />
        <button type="button" aria-label="Recolher painel" className="views-panel__recolher">
          <i className="ti ti-chevron-left" />
        </button>
      </div>

      <nav className="views-panel__lista">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={'views-panel__item' + (v.id === ativa ? ' views-panel__item--ativo' : '')}
            aria-current={v.id === ativa ? 'true' : undefined}
            onClick={() => onSelecionar(v)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <div className="views-panel__sep" />
      <p className="views-panel__grupo">Visualizações pessoais</p>
      <nav className="views-panel__lista">
        {PESSOAIS.map((v) => (
          <button
            key={v.id}
            type="button"
            className="views-panel__item views-panel__item--inerte"
            title="Visualização personalizada — em breve"
            aria-disabled="true"
          >
            {v.label}
          </button>
        ))}
      </nav>

      <button type="button" className="views-panel__personalizar">
        Personalizar visualizações
      </button>
    </aside>
  )
}
