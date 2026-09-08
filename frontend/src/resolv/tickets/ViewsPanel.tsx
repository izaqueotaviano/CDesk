import { useState } from 'react'
import { useConsultaDeMidia } from '../shell/useConsultaDeMidia'
import { useResumoFila } from './dados'
import { duracaoEmMinutos } from './format'

// --------------------------------------------------------------------------
// painel recolhido — item (rodada 3)
// --------------------------------------------------------------------------

/** localStorage direto com try/catch, não um store novo pra uma chave só —
 *  mesmo padrão de preferência POR DISPOSITIVO já usado em
 *  realtime/avisos.ts (`escolhaSalva`/`salvarEscolha`): "painel recolhido
 *  neste computador" não é dado de conta, é do aparelho/janela em que a
 *  pessoa está agora. */
const CHAVE_RECOLHIDO = 'resolv-fila-painel-recolhido'

function escolhaRecolhidoSalva(): 'sim' | 'nao' | null {
  try {
    const salvo = localStorage.getItem(CHAVE_RECOLHIDO)
    return salvo === 'sim' || salvo === 'nao' ? salvo : null
  } catch {
    return null // aba anônima/preview sem storage: cai no padrão do breakpoint
  }
}

function salvarEscolhaRecolhido(valor: 'sim' | 'nao') {
  try {
    localStorage.setItem(CHAVE_RECOLHIDO, valor)
  } catch {
    // melhor esforço: sem persistir, o estado ainda vale nesta sessão
  }
}

/** Mesmo breakpoint de tablet do resto da casa — resolv/shell/topbar.scss:17
 *  ($bp-lg, "a busca perde a largura própria"), copiado em vez de importado
 *  pelo mesmo motivo de lá: nenhum .scss/.ts de resolv/ usa @use ou import
 *  cruzado entre módulos hoje, e o único ganho seria um número.
 *
 *  1023px, não 1024px: topbar.scss usa `max-width: $bp-lg - 1px` (a query CSS
 *  de lá), e copiar só o número sem o "- 1px" faria os dois discordarem
 *  exatamente na largura 1024px — a topbar ainda desktop, este painel já
 *  recolhido por padrão. */
const CONSULTA_JANELA_ESTREITA = '(max-width: 1023px)'

/**
 * Só decide o PADRÃO de quem nunca clicou no botão de recolher — a escolha
 * salva (acima) manda em qualquer largura. Reage a redimensionamento de
 * verdade (não só a carga inicial): é o caso de quem arrasta a borda da
 * janela pra dividir a tela com outra coisa enquanto trabalha, o motivo
 * citado na auditoria — não só de quem já abre em notebook pequeno.
 * (O hook em si é o do shell — `useConsultaDeMidia`; o que é deste painel é
 * só a largura de corte.)
 */
function useJanelaEstreita(): boolean {
  return useConsultaDeMidia(CONSULTA_JANELA_ESTREITA)
}

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

  // Escolha explícita (localStorage) manda em qualquer largura; sem ela, o
  // padrão segue a janela — ver comentário de `useJanelaEstreita` acima.
  const [escolha, setEscolha] = useState<'sim' | 'nao' | null>(() => escolhaRecolhidoSalva())
  const janelaEstreita = useJanelaEstreita()
  const recolhido = escolha != null ? escolha === 'sim' : janelaEstreita

  function alternarRecolhido() {
    const novo: 'sim' | 'nao' = recolhido ? 'nao' : 'sim'
    setEscolha(novo)
    salvarEscolhaRecolhido(novo)
  }

  /** Contexto que o resumo já traz de graça e cabe no `title` sem virar
   *  widget: quanto tempo o mais antigo da fila sem dono está esperando. */
  function tituloDaVisao(v: Visualizacao): string | undefined {
    if (v.id !== 'nao-atribuidos' || esperaMaisLonga == null) return undefined
    return `O mais antigo espera há ${duracaoEmMinutos(esperaMaisLonga)}`
  }

  // Recolhido: só a faixa com o botão de expandir — busca, lista de views,
  // pessoais e "personalizar" somem juntos. Cedo aqui em vez de esconder por
  // CSS porque isto também tira as ~15 linhas da ordem de tabulação; ninguém
  // tabula por controles que não estão visíveis (mesmo raciocínio do
  // `readOnly` do campo de busca logo abaixo, só que para sumiço, não pra
  // "em breve").
  if (recolhido) {
    return (
      <aside className="lista-tickets__views lista-tickets__views--recolhido" aria-label="Visualizações">
        <button
          type="button"
          className="views-panel__expandir"
          aria-label="Expandir painel de visualizações"
          title="Expandir painel"
          onClick={alternarRecolhido}
        >
          <i className="ti ti-chevron-right" />
        </button>
      </aside>
    )
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
        {/* Item (rodada 3): era o botão "em breve" da rodada 2 — agora liga
            de verdade (estado + persistência acima). */}
        <button
          type="button"
          aria-label="Recolher painel"
          title="Recolher painel"
          className="views-panel__recolher"
          onClick={alternarRecolhido}
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
