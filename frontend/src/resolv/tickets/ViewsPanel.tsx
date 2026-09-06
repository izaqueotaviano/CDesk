import { useResumoFila } from './dados'
import { duracaoEmMinutos } from './format'

/**
 * Painel do agente — as "visualizações salvas" da lateral do print. Cada uma
 * aponta para um `?view=` REAL do backend (o parâmetro `view` do
 * /api/v1/tickets/ tem exatamente estes valores). As duas do rodapé
 * ("Next Store", "Mix Lar") são visualizações personalizadas por empresa no
 * sistema antigo — sem endpoint de saved-views ainda, ficam como placeholder
 * honesto (inertes), não como link quebrado.
 *
 * O número ao lado de cada uma vem de `GET /tickets/resumo/` (uma chamada
 * para as dez visões): sem ele, "Não atribuídos" com 0 e com 40 desenhavam
 * igual e o agente abria gaveta por gaveta para descobrir onde está o
 * trabalho.
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
  // Separa o que está na SUA mão do que espera o cliente — "Meus tickets não
  // resolvidos" mistura os dois, e são coisas opostas na hora de trabalhar.
  // A definição é do servidor (SAVED_VIEWS em apps/tickets/views.py: meu,
  // não fechado, e o último a falar não fui eu).
  { id: 'aguardando-voce', label: 'Aguardando você', view: 'aguardando-voce' },
  { id: 'todos', label: 'Todos os tickets', view: 'todos' },
  { id: 'prioritario', label: 'Tickets Prioritário', priorityOnly: true },
  { id: 'sem-atendimento', label: 'Tickets Sem Atendimento', view: 'sem-atendimento' },
  { id: 'nao-resolvidos', label: 'Todos os tickets não resolvidos', view: 'nao-resolvidos' },
  // Item 24: o nome antigo ("Todos os tickets - Kanban") prometia "está no
  // quadro" — mas todo ticket visível está no quadro (é a mesma fila vista
  // por status), então isso não recortaria nada. O filtro real do servidor
  // é `cards__due_at__isnull=False` — "tem prazo interno anotado no quadro"
  // (`_apply_saved_view` em apps/tickets/views.py:150-151, documentado lá
  // como intencional). O sentido mudou no servidor; só o rótulo ficou pra
  // trás — o filtro está certo, não mexe nele.
  { id: 'em-kanban', label: 'Com prazo no quadro', view: 'em-kanban' },
  { id: 'nao-atribuidos', label: 'Tickets não atribuídos', view: 'nao-atribuidos' },
  { id: 'resolvidos', label: 'Tickets Resolvidos', view: 'resolvidos' },
  { id: 'internos', label: 'Tickets Internos', view: 'internos' },
]

// FORA da lista de propósito: `mencionam-voce` existe e é testada no backend,
// mas menção só nasce da marcação `@[user:N]` gravada em nota interna
// (apps/tickets/services/mentions.py) e NENHUMA tela do Resolv sabe escrever
// essa marcação — o compositor não tem autocomplete de `@`. A gaveta seria
// uma linha permanentemente em 0. Entra junto com o autocomplete, que é quem
// dá conteúdo a ela.

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
  const { data: resumo, isError } = useResumoFila()
  const contagens = resumo?.visoes
  const esperaMaisLonga = resumo?.nao_atribuidos.espera_mais_longa_min ?? null

  /** Contexto que o resumo já traz de graça e cabe no `title` sem virar
   *  widget: quanto tempo o mais antigo da fila sem dono está esperando. */
  function tituloDaVisao(v: Visualizacao): string | undefined {
    if (v.id !== 'nao-atribuidos' || esperaMaisLonga == null) return undefined
    return `O mais antigo espera há ${duracaoEmMinutos(esperaMaisLonga)}`
  }

  return (
    <aside className="lista-tickets__views" aria-label="Visualizações">
      <div className="views-panel__busca">
        <i className="ti ti-search" />
        {/* Filtrar visualizações ainda não existe. `readOnly` + `aria-disabled`
            em vez de `disabled` porque o campo continua focalizável — é assim
            que o leitor de tela e o teclado chegam ao "em breve"; um input
            desabilitado sai da ordem de foco e a explicação some junto. */}
        <input
          type="text"
          placeholder="Painel do agente"
          aria-label="Filtrar visualizações"
          title="Filtrar visualizações — em breve"
          aria-disabled="true"
          readOnly
        />
        <button
          type="button"
          aria-label="Recolher painel"
          title="Recolher painel — em breve"
          aria-disabled="true"
          className="views-panel__recolher"
        >
          <i className="ti ti-chevron-left" />
        </button>
      </div>

      <nav className="views-panel__lista">
        {VIEWS.map((v) => {
          // "Tickets Prioritário" não é uma visão salva do servidor (é
          // `view=nao-resolvidos` + `priority=urgent`, ver
          // PaginaListaTickets), então o resumo não tem número para ela —
          // e nenhum número é melhor que um número de outra pergunta.
          const contagem = v.view ? contagens?.[v.view] : undefined
          return (
            <button
              key={v.id}
              type="button"
              className={'views-panel__item' + (v.id === ativa ? ' views-panel__item--ativo' : '')}
              aria-current={v.id === ativa ? 'true' : undefined}
              title={tituloDaVisao(v)}
              onClick={() => onSelecionar(v)}
            >
              <span className="views-panel__rotulo">{v.label}</span>
              {contagem != null && (
                <span
                  className={
                    'views-panel__contagem' + (contagem === 0 ? ' views-panel__contagem--zero' : '')
                  }
                >
                  {contagem}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Carregando não mostra esqueleto: a lista já é clicável sem os
          números, e um placeholder piscando ao lado de nove linhas custa mais
          atenção do que o número que ele substitui. Falhar, porém, precisa
          aparecer — senão "sem número" lê como "zero". */}
      {isError && (
        <p className="views-panel__aviso" role="status">
          Contagens indisponíveis agora.
        </p>
      )}

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

      <button
        type="button"
        className="views-panel__personalizar"
        title="Personalizar visualizações — em breve"
        aria-disabled="true"
      >
        Personalizar visualizações
      </button>
    </aside>
  )
}
