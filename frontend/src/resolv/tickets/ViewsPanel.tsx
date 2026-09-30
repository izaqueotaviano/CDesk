import { useState } from 'react'
import { useConsultaDeMidia } from '../shell/useConsultaDeMidia'
import { useResumoFila, useVisoesPessoais } from './dados'
import { duracaoEmMinutos } from './format'
import type { VisaoPessoal } from './tipos'
import { VISOES_DO_SISTEMA, type Visualizacao } from './visoes'

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

/** Mesmo breakpoint de tablet do resto da casa — resolv/shell/topbar.scss
 *  ($bp-lg), com o "- 1px" de lá: copiar só o número faria os dois
 *  discordarem exatamente na largura 1024px. Só decide o PADRÃO de quem
 *  nunca clicou no botão de recolher; a escolha salva manda em qualquer
 *  largura. */
const CONSULTA_JANELA_ESTREITA = '(max-width: 1023px)'

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

interface PropsLista {
  /** id da visão do sistema ativa (ignorado quando há pessoal ativa) */
  ativa: string
  ativaPessoal: number | null
  onSelecionar: (v: Visualizacao) => void
  onSelecionarPessoal: (v: VisaoPessoal) => void
  onPersonalizar: () => void
  /** Texto do campo "Filtrar visualizações" — de fora, porque no painel o
   *  campo mora no cabeçalho (junto do recolher) e na folha do celular, no
   *  topo da própria lista. */
  filtro: string
}

/**
 * O miolo do painel: as visões do sistema e as pessoais. É o mesmo no
 * painel lateral (computador) e na folha de visões do celular.
 */
export function ListaDeVisoes({
  ativa,
  ativaPessoal,
  onSelecionar,
  onSelecionarPessoal,
  onPersonalizar,
  filtro,
}: PropsLista) {
  const { data: resumo, isError } = useResumoFila()
  const {
    data: pessoais,
    isLoading: carregandoPessoais,
    isError: erroPessoais,
  } = useVisoesPessoais()
  const contagens = resumo?.visoes
  const esperaMaisLonga = resumo?.nao_atribuidos.espera_mais_longa_min ?? null

  const termo = semAcento(filtro.trim())
  const casa = (rotulo: string) => !termo || semAcento(rotulo).includes(termo)
  const sistema = VISOES_DO_SISTEMA.filter((v) => casa(v.label))
  const minhas = (pessoais ?? []).filter((v) => casa(v.name))

  /** Contexto que o resumo já traz de graça e cabe no `title` sem virar
   *  widget: quanto tempo o mais antigo da fila sem dono está esperando. */
  function tituloDaVisao(v: Visualizacao): string | undefined {
    if (v.id !== 'nao-atribuidos' || esperaMaisLonga == null) return undefined
    return `O mais antigo espera há ${duracaoEmMinutos(esperaMaisLonga)}`
  }

  const nenhumaCasa = termo && sistema.length === 0 && minhas.length === 0

  return (
    <>
      {nenhumaCasa && <p className="views-panel__aviso">Nenhuma visualização com esse nome.</p>}

      {sistema.length > 0 && (
        <nav className="views-panel__lista" aria-label="Visualizações do sistema">
          {sistema.map((v) => {
            // "Tickets prioritários" não é uma visão salva do servidor (é
            // `nao-resolvidos` + urgente), então o resumo não tem número
            // para ela — e nenhum número é melhor que o de outra pergunta.
            const contagem = v.prioridade ? undefined : contagens?.[v.view]
            const eAtiva = ativaPessoal == null && v.id === ativa
            return (
              <button
                key={v.id}
                type="button"
                className={'views-panel__item' + (eAtiva ? ' views-panel__item--ativo' : '')}
                aria-current={eAtiva ? 'true' : undefined}
                title={tituloDaVisao(v)}
                onClick={() => onSelecionar(v)}
              >
                <span className="views-panel__rotulo">{v.label}</span>
                {contagem != null && (
                  <span
                    className={
                      'views-panel__contagem' +
                      (contagem === 0 ? ' views-panel__contagem--zero' : '')
                    }
                  >
                    {contagem}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      )}

      {/* Carregando não mostra esqueleto: a lista já é clicável sem os
          números. Falhar, porém, precisa aparecer — senão "sem número" lê
          como "zero". */}
      {isError && (
        <p className="views-panel__aviso" role="status">
          Contagens indisponíveis agora.
        </p>
      )}

      <div className="views-panel__sep" />
      <p className="views-panel__grupo" id="views-panel-pessoais">
        Visualizações pessoais
      </p>
      {minhas.length > 0 && (
        <nav className="views-panel__lista" aria-labelledby="views-panel-pessoais">
          {minhas.map((v) => {
            const eAtiva = v.id === ativaPessoal
            return (
              <button
                key={v.id}
                type="button"
                className={'views-panel__item' + (eAtiva ? ' views-panel__item--ativo' : '')}
                aria-current={eAtiva ? 'true' : undefined}
                onClick={() => onSelecionarPessoal(v)}
              >
                <span className="views-panel__rotulo">{v.name}</span>
                {v.count != null && (
                  <span
                    className={
                      'views-panel__contagem' +
                      (v.count === 0 ? ' views-panel__contagem--zero' : '')
                    }
                  >
                    {v.count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      )}
      {!termo && !carregandoPessoais && !erroPessoais && (pessoais ?? []).length === 0 && (
        <p className="views-panel__dica">
          Filtre a lista e use “Salvar visão” para voltar a esse recorte com um clique.
        </p>
      )}
      {erroPessoais && (
        <p className="views-panel__aviso" role="status">
          Não foi possível carregar suas visualizações.
        </p>
      )}

      {(pessoais ?? []).length > 0 && (
        <button type="button" className="views-panel__personalizar" onClick={onPersonalizar}>
          <i className="ti ti-settings" aria-hidden="true" />
          Personalizar visualizações
        </button>
      )}
    </>
  )
}

type PropsPainel = Omit<PropsLista, 'filtro'>

/**
 * Painel do agente — a coluna de visualizações à esquerda da fila
 * (computador e tablet; no celular a mesma lista abre numa folha, ver
 * PaginaListaTickets). O número ao lado de cada visão do sistema vem de
 * `GET /tickets/resumo/` (uma chamada para todas); o das pessoais, de
 * `GET /ticket-views/` (o servidor conta cada uma no seu escopo).
 */
export function ViewsPanel(props: PropsPainel) {
  const [filtro, setFiltro] = useState('')
  // Escolha explícita (localStorage) manda em qualquer largura; sem ela, o
  // padrão segue a janela.
  const [escolha, setEscolha] = useState<'sim' | 'nao' | null>(() => escolhaRecolhidoSalva())
  const janelaEstreita = useConsultaDeMidia(CONSULTA_JANELA_ESTREITA)
  const recolhido = escolha != null ? escolha === 'sim' : janelaEstreita

  function alternarRecolhido() {
    const novo: 'sim' | 'nao' = recolhido ? 'nao' : 'sim'
    setEscolha(novo)
    salvarEscolhaRecolhido(novo)
  }

  // Recolhido: só a faixa com o botão de expandir. Cedo aqui em vez de
  // esconder por CSS porque isto também tira as ~15 linhas da ordem de
  // tabulação.
  if (recolhido) {
    return (
      <aside
        className="lista-tickets__views lista-tickets__views--recolhido"
        aria-label="Visualizações"
      >
        <button
          type="button"
          className="views-panel__expandir"
          aria-label="Expandir painel de visualizações"
          title="Expandir painel"
          onClick={alternarRecolhido}
        >
          <i className="ti ti-layout-sidebar-left-expand" aria-hidden="true" />
        </button>
      </aside>
    )
  }

  return (
    <aside className="lista-tickets__views" aria-label="Visualizações">
      <div className="views-panel__cabeca">
        <label className="views-panel__busca">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            type="search"
            placeholder="Filtrar visualizações"
            aria-label="Filtrar visualizações"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filtro) {
                e.stopPropagation()
                setFiltro('')
              }
            }}
          />
        </label>
        <button
          type="button"
          aria-label="Recolher painel"
          title="Recolher painel"
          className="views-panel__recolher"
          onClick={alternarRecolhido}
        >
          <i className="ti ti-layout-sidebar-left-collapse" aria-hidden="true" />
        </button>
      </div>
      <ListaDeVisoes {...props} filtro={filtro} />
    </aside>
  )
}
