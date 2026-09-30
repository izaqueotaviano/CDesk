import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/cvz/components'
import { IconChevronDown } from '@/cvz/components/icons'
import { AbaBackup } from './AbaBackup'
import { AbaCalendarios } from './AbaCalendarios'
import { AbaCategorias } from './AbaCategorias'
import { AbaChat } from './AbaChat'
import { AbaEquipes } from './AbaEquipes'
import { AbaImportar } from './AbaImportar'
import { AbaModeracao } from './AbaModeracao'
import { AbaPapeis } from './AbaPapeis'
import { AbaPlanos } from './AbaPlanos'
import { AbaServicos } from './AbaServicos'
import { AbaSistema } from './AbaSistema'
import { AbaTelaDeLogin } from './AbaTelaDeLogin'
import { AbaSla } from './AbaSla'
import { AbaStatus } from './AbaStatus'
import { AbaTags } from './AbaTags'
import './configuracoes.scss'

interface Secao {
  /** Valor de `?aba=` — os ids são os MESMOS da fileira de abas antiga, então
   *  link salvo e favorito continuam abrindo a seção certa. */
  id: string
  rotulo: string
  descricao: string
  conteudo: () => ReactNode
}

/**
 * As seções agrupadas pelo que a pessoa veio fazer, não pela ordem em que
 * foram construídas. Eram quinze abas numa fileira só, que passava da largura
 * da tela e cortava as últimas (Importar, Backup) sem aviso de que existiam.
 */
const GRUPOS: { rotulo: string; secoes: Secao[] }[] = [
  {
    rotulo: 'Atendimento',
    secoes: [
      { id: 'status', rotulo: 'Status', descricao: 'As etapas por onde o ticket passa, da abertura ao fechamento.', conteudo: () => <AbaStatus /> },
      { id: 'servicos', rotulo: 'Serviços', descricao: 'O que a equipe atende. Cada categoria pode ficar dentro de um serviço.', conteudo: () => <AbaServicos /> },
      { id: 'categorias', rotulo: 'Categorias', descricao: 'Assuntos para classificar os tickets na abertura e na triagem.', conteudo: () => <AbaCategorias /> },
      { id: 'tags', rotulo: 'Tags', descricao: 'Marcadores livres para agrupar e filtrar tickets.', conteudo: () => <AbaTags /> },
      { id: 'sla', rotulo: 'SLA', descricao: 'Prazos de primeira resposta e de resolução, por plano e por equipe.', conteudo: () => <AbaSla /> },
      // Rótulo "Expediente", não "Calendário", pra não confundir com o
      // item de mesmo nome no menu principal (agenda/eventos). Aqui é só
      // horário comercial + feriados (BusinessCalendar/Holiday).
      { id: 'calendarios', rotulo: 'Expediente', descricao: 'Horário de atendimento e feriados, que contam no prazo do SLA.', conteudo: () => <AbaCalendarios /> },
    ],
  },
  {
    rotulo: 'Pessoas',
    secoes: [
      { id: 'equipes', rotulo: 'Equipes', descricao: 'Os times, quem faz parte de cada um e o que cada time enxerga.', conteudo: () => <AbaEquipes /> },
      { id: 'papeis', rotulo: 'Papéis', descricao: 'O que cada perfil de acesso pode ver e fazer.', conteudo: () => <AbaPapeis /> },
      { id: 'planos', rotulo: 'Planos', descricao: 'Os planos de suporte dos clientes: limite de tickets, franquia e chat.', conteudo: () => <AbaPlanos /> },
    ],
  },
  {
    rotulo: 'Canais',
    secoes: [
      // Parâmetros do chat (ChatConfig): boas-vindas, timeout da fila,
      // teto de atendimentos por agente (que também é o teto de painéis
      // do mini chat) e a escala da avaliação.
      { id: 'chat', rotulo: 'Chat', descricao: 'Boas-vindas, fila, atendimentos por agente e avaliação.', conteudo: () => <AbaChat /> },
      // Lista de palavras censuradas no chat: a regra (censura na exibição,
      // retroativa) é do backend; aqui é só a lista. Mora em Canais, junto
      // do Chat, porque é do chat que ela trata.
      { id: 'moderacao', rotulo: 'Moderação', descricao: 'Palavras escondidas nas conversas do chat, dos dois lados.', conteudo: () => <AbaModeracao /> },
      { id: 'login', rotulo: 'Tela de login', descricao: 'Textos e imagem do painel de entrada, para a equipe e para os clientes.', conteudo: () => <AbaTelaDeLogin /> },
    ],
  },
  {
    rotulo: 'Sistema',
    secoes: [
      // Não é cadastro: são os parâmetros operacionais (linha única em
      // banco) que valem para o sistema todo.
      { id: 'operacao', rotulo: 'Operação', descricao: 'Anexos, fechamento automático, pesquisa de satisfação, segurança e e-mail.', conteudo: () => <AbaSistema /> },
      // Ferramentas de administração (apps/ferramentas): trazer os tickets
      // do Movidesk pela API, e o backup/restauração do banco. Por último
      // porque não são cadastro nem parâmetro, são operações.
      { id: 'importar', rotulo: 'Importar', descricao: 'Traga pessoas e tickets do Movidesk.', conteudo: () => <AbaImportar /> },
      { id: 'backup', rotulo: 'Backup', descricao: 'Cópias do banco de dados: criar, baixar, restaurar e agendar.', conteudo: () => <AbaBackup /> },
    ],
  },
]

const SECOES = GRUPOS.flatMap((g) => g.secoes)
const ABA_PADRAO = SECOES[0].id

/** A seção padrão não carrega `?aba=` — a URL limpa continua sendo a de
 *  entrada, como era com as abas. */
function buscaDaSecao(id: string) {
  return id === ABA_PADRAO ? '' : `?aba=${id}`
}

/**
 * Configurações: navegação por seção à esquerda, agrupada, e a seção aberta
 * à direita. Em largura estreita a lista vira um seletor no topo — quinze
 * itens numa fita que rola de lado escondem mais do que mostram.
 *
 * "Empresas"/"Usuários" não aparecem aqui: já têm tela própria em /clientes.
 */
export function PaginaConfiguracoes() {
  const [searchParams, setSearchParams] = useSearchParams()
  const raiz = useRef<HTMLDivElement>(null)

  // A seção ativa mora na URL (?aba=tags), não em estado local — achado da
  // revisão de UX ("Deep Linking"): sem isso, um F5 ou um link compartilhado
  // sempre voltava pra primeira seção, mesmo que a pessoa estivesse
  // trabalhando em "Tags" havia 10 minutos.
  const abaParam = searchParams.get('aba')
  const ativa = SECOES.find((s) => s.id === abaParam) ?? SECOES[0]

  // Cada seção monta na primeira visita e continua montada (escondida)
  // depois. Montar as quinze de uma vez disparava as consultas de todas ao
  // abrir a página; desmontar ao sair perderia o que a pessoa digitou num
  // formulário ainda não salvo (Operação, Chat) só por espiar outra seção.
  const [visitadas, setVisitadas] = useState<ReadonlySet<string>>(() => new Set([ativa.id]))
  if (!visitadas.has(ativa.id)) setVisitadas(new Set(visitadas).add(ativa.id))

  /** A navegação lateral é fixa (sticky), então quem trocou de seção lá
   *  embaixo de uma lista longa cairia no meio da próxima. Volta ao topo. */
  function voltarAoTopo() {
    raiz.current?.closest('.cvz-superficie')?.scrollTo?.({ top: 0 })
  }

  function aoClicarNaSecao(e: MouseEvent<HTMLAnchorElement>) {
    // Ctrl/⌘+clique abre em outra aba do navegador: não mexe nesta.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    voltarAoTopo()
  }

  function trocarPeloSeletor(id: string) {
    setSearchParams(id === ABA_PADRAO ? {} : { aba: id }, { replace: true })
    voltarAoTopo()
  }

  return (
    <div className="cfg-pagina" ref={raiz}>
      <PageHeader title="Configurações" description="Cadastros, canais e parâmetros que valem para toda a equipe." />

      <div className="cfg-pagina__corpo">
        <nav className="cfg-nav" aria-label="Seções de configuração">
          {GRUPOS.map((g) => (
            <div key={g.rotulo} className="cfg-nav__grupo">
              {/* Rótulo e não título (h2): cabeçalho dentro da navegação
               *  entraria no atalho de títulos do leitor de tela, misturado
               *  com o da seção aberta. A lista é que carrega o nome. */}
              <p className="cfg-nav__titulo" id={`cfg-grupo-${g.rotulo}`}>
                {g.rotulo}
              </p>
              <ul className="cfg-nav__lista" aria-labelledby={`cfg-grupo-${g.rotulo}`}>
                {g.secoes.map((s) => (
                  <li key={s.id}>
                    <Link
                      to={{ search: buscaDaSecao(s.id) }}
                      replace
                      className="cfg-nav__item"
                      aria-current={s.id === ativa.id ? 'page' : undefined}
                      onClick={aoClicarNaSecao}
                    >
                      {s.rotulo}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Seletor nativo em tela estreita: o `<optgroup>` mantém os grupos,
         *  e o sistema operacional já sabe abrir uma lista longa no celular. */}
        <div className="cfg-seletor select-wrap">
          <select
            className="control control--select"
            aria-label="Seção de configuração"
            value={ativa.id}
            onChange={(e) => trocarPeloSeletor(e.target.value)}
          >
            {GRUPOS.map((g) => (
              <optgroup key={g.rotulo} label={g.rotulo}>
                {g.secoes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.rotulo}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <IconChevronDown className="select-wrap__caret" />
        </div>

        <div className="cfg-pagina__conteudo">
          {SECOES.filter((s) => visitadas.has(s.id)).map((s) => (
            <section
              key={s.id}
              className="cfg-secao"
              aria-labelledby={`cfg-secao-${s.id}`}
              hidden={s.id !== ativa.id}
            >
              <header className="cfg-secao__topo">
                <h2 className="cfg-secao__titulo" id={`cfg-secao-${s.id}`}>
                  {s.rotulo}
                </h2>
                <p className="cfg-secao__descricao">{s.descricao}</p>
              </header>
              {s.conteudo()}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
