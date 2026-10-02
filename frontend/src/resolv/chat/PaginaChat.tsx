import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  useCaixaDeClientes,
  useConfigChat,
  useFilaChat,
  useMeusChats,
  usePegarChat,
} from '@/api/chat'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { ConversaChat, type NavegacaoDaConversa } from './ConversaChat'
import { EsqueletoConversa } from './Esqueletos'
import { Finalizados } from './Finalizados'
import { useAlturaVisivel, useModoDoConsole } from './layout'
import { ListaClientes } from './ListaClientes'
import { ListaConversas } from './ListaConversas'
import { PainelChat } from './PainelChat'
import { ThreadDoCliente } from './ThreadDoCliente'
import './chat.scss'

/** O que a navegação empurra no histórico — é o que deixa o "voltar" (do
 *  navegador ou o da tela) desfazer exatamente o passo que a pessoa deu. */
interface EstadoDeNavegacao {
  daLista?: boolean
  abriuDetalhes?: boolean
}

/**
 * Console de chat do agente — rota própria (docs/07 F5): lista (fila +
 * conversas) | a conversa | cliente e ações.
 *
 * A coluna da esquerda agrupa POR PESSOA (`ListaClientes`), não por
 * abertura: com várias aberturas por cliente, uma linha por abertura vira
 * uma lista que ninguém navega. Abrir uma pessoa mostra o histórico inteiro
 * dela numa rolagem só (`ThreadDoCliente`), com marcadores discretos onde um
 * atendimento termina e o próximo começa.
 *
 * O agrupamento é de APRESENTAÇÃO: cada abertura continua uma linha no banco,
 * com o próprio SLA, a própria avaliação e o próprio ciclo — e a visão do
 * CLIENTE continua separada por atendimento.
 *
 * O que está na tela mora na URL — `?cliente=<id>` para a thread de uma
 * pessoa, `?chat=<id>` para uma abertura específica (a fila, que ainda não
 * tem dono, e os finalizados), `&detalhes=1` para a folha do cliente. F5 ou
 * link colado voltam pra mesma coisa, e o voltar do navegador desfaz o
 * último passo — no celular, é ele que volta da conversa para a lista.
 *
 * Três formas pela largura (`useModoDoConsole`, ./layout): três colunas, duas
 * com o painel virando folha, ou uma coisa por vez no celular.
 */
export function PaginaChat() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const estado = (location.state ?? {}) as EstadoDeNavegacao
  const modo = useModoDoConsole()
  useAlturaVisivel()

  const chatParam = params.get('chat')
  const chatId = chatParam && /^\d+$/.test(chatParam) ? Number(chatParam) : null
  const clienteParam = params.get('cliente')
  const clienteId = clienteParam && /^\d+$/.test(clienteParam) ? Number(clienteParam) : null
  const detalhesAbertos = params.get('detalhes') === '1'

  const { data: me } = useMe()
  const fila = useFilaChat()
  const meus = useMeusChats()
  const clientes = useCaixaDeClientes()
  const config = useConfigChat()
  const pegar = usePegarChat()
  const [erroFila, setErroFila] = useState<string | null>(null)
  // "Ativos" (fila + conversas) ou "Finalizados". Mora na URL como a
  // conversa: recarregar a página não devolve a pessoa para a aba errada.
  const aba = params.get('aba') === 'finalizados' ? 'finalizados' : 'ativos'

  // "agora" de referência para os tempos relativos — o instante do último
  // fetch da fila, não Date.now() em render (impuro; recalcularia à toa)
  const agoraMs = Math.max(fila.dataUpdatedAt, clientes.dataUpdatedAt) || 0

  const linha = (clientes.data ?? []).find((c) => c.client_id === clienteId)
  // Escrever é na abertura VIVA; sem nenhuma, a thread abre na mais recente e
  // o `ConversaChat` já a desenha encerrada (sem compositor).
  const chatDaThread = linha ? (linha.open_chat_id ?? linha.last_chat_id) : null
  const temSelecao = (clienteId != null && chatDaThread != null) || chatId != null

  // Sem seleção, cai na primeira conversa da caixa — é o que a pessoa estava
  // fazendo antes de sair da tela. No celular NÃO: lá a lista é uma tela
  // inteira, e pular direto para uma conversa esconderia a lista que ela
  // veio ver.
  const primeiroCliente = clientes.data?.[0]?.client_id
  useEffect(() => {
    if (modo === 'um') return
    if (aba === 'ativos' && chatId == null && clienteId == null && primeiroCliente != null) {
      setParams({ cliente: String(primeiroCliente) }, { replace: true })
    }
  }, [modo, aba, chatId, clienteId, primeiroCliente, setParams])

  // Escolher empurra uma entrada no histórico, marcada: é o que permite ao
  // "voltar" da tela desfazer o passo com `navigate(-1)` (o mesmo que o
  // botão do navegador faria) em vez de empilhar mais uma entrada.
  const empurrar = { state: { daLista: true } satisfies EstadoDeNavegacao }

  /** Uma ABERTURA específica: a fila (ainda sem dono) e os finalizados. */
  function selecionarChat(id: number) {
    const proximo: Record<string, string> = { chat: String(id) }
    if (aba === 'finalizados') proximo.aba = 'finalizados'
    setParams(proximo, empurrar)
  }

  /** Uma PESSOA: a thread com todo o histórico dela. */
  function selecionarCliente(id: number) {
    setParams({ cliente: String(id) }, empurrar)
  }

  function trocarAba(proxima: 'ativos' | 'finalizados') {
    const atual: Record<string, string> = {}
    if (proxima === 'finalizados') {
      atual.aba = 'finalizados'
      if (chatParam) atual.chat = chatParam
    } else if (clienteParam) {
      atual.cliente = clienteParam
    }
    setParams(atual)
  }

  /** Voltar da conversa para a lista (só existe no celular). */
  function voltarParaLista() {
    if (estado.daLista) {
      navigate(-1)
      return
    }
    // chegou por link direto: não há "antes" no histórico para voltar
    setParams(aba === 'finalizados' ? { aba: 'finalizados' } : {}, { replace: true })
  }

  function abrirDetalhes() {
    const proximo = new URLSearchParams(params)
    proximo.set('detalhes', '1')
    setParams(proximo, { state: { ...estado, abriuDetalhes: true } satisfies EstadoDeNavegacao })
  }

  function fecharDetalhes() {
    if (estado.abriuDetalhes) {
      navigate(-1)
      return
    }
    const proximo = new URLSearchParams(params)
    proximo.delete('detalhes')
    setParams(proximo, { replace: true, state: estado })
  }

  function pegarChat(id: number) {
    setErroFila(null)
    pegar.mutate(id, {
      // pegou: a conversa deixa de ser "uma abertura na fila" e passa a ser
      // "a conversa com aquela pessoa" — é na thread dela que ela continua
      onSuccess: (c) => setParams({ cliente: String(c.client_id) }, empurrar),
      // perdeu a corrida ("já foi pego"), ou está no limite — o backend é
      // quem decide; a tela só repete o motivo e a lista se atualiza pelo
      // evento `chat_taken` que chega pra todo mundo
      onError: (e) =>
        setErroFila(
          e instanceof ApiError
            ? (e.detail ?? 'Não foi possível pegar.')
            : 'Não foi possível pegar.',
        ),
    })
  }

  // o painel da direita é sempre de UMA abertura — a da thread, ou a que
  // está selecionada avulsa: ficha, tags, encerramento e conversão são do
  // atendimento, não da pessoa
  const chatDoPainel = clienteId != null ? chatDaThread : chatId

  // o painel é coluna no desktop largo e folha abaixo disso: o botão
  // "Detalhes do cliente" só existe quando há folha para abrir
  const navegacao: NavegacaoDaConversa = {
    onVoltar: modo === 'um' ? voltarParaLista : undefined,
    onDetalhes: modo !== 'tres' && chatDoPainel != null ? abrirDetalhes : undefined,
    detalhesAbertos: detalhesAbertos && modo !== 'tres',
  }

  const limite = config.data?.max_chats_per_agent
  const emAtendimento = meus.data?.length ?? 0
  // o próximo da fila é quem espera há MAIS tempo — a ordem que a fila
  // promete a quem está nela
  const proximoDaFila = [...(fila.data ?? [])].sort(
    (a, b) => new Date(a.queued_at).getTime() - new Date(b.queued_at).getTime(),
  )[0]

  // No celular, uma coisa por vez: sem seleção mostra a lista; com seleção,
  // a conversa (a lista volta pelo "voltar").
  const mostraLista = modo !== 'um' || !temSelecao
  const mostraConversa = modo !== 'um' || temSelecao

  return (
    <div className="chat-console" data-modo={modo}>
      {mostraLista && (
        <nav className="cc-atalhos" aria-label="Atalhos do chat">
          <h2 className="cc-atalhos__titulo">Chat</h2>
          <p className="cc-atalhos__grupo">Atalhos</p>
          <button
            type="button"
            className="cc-atalhos__item"
            aria-current={aba === 'ativos' ? 'page' : undefined}
            title="Início"
            onClick={() => trocarAba('ativos')}
          >
            <i className="ti ti-home" aria-hidden="true" />
            <span className="cc-atalhos__rotulo">Início</span>
          </button>
          {/* Estrutura visual autorizada: os fluxos serão definidos depois. */}
          <button type="button" className="cc-atalhos__item" disabled title="Menções — em breve">
            <i className="ti ti-at" aria-hidden="true" />
            <span className="cc-atalhos__rotulo">Menções</span>
            <span className="cc-atalhos__breve">Em breve</span>
          </button>
          <button
            type="button"
            className="cc-atalhos__item"
            disabled
            title="Com estrela — em breve"
          >
            <i className="ti ti-star" aria-hidden="true" />
            <span className="cc-atalhos__rotulo">Com estrela</span>
            <span className="cc-atalhos__breve">Em breve</span>
          </button>
        </nav>
      )}
      {mostraLista && (
        <aside className="cc-lista" aria-label="Conversas">
          <h2 className="cc-lista__titulo">{aba === 'ativos' ? 'Início' : 'Finalizados'}</h2>
          <div className="cc-lista__abas" role="tablist" aria-label="Fila e finalizados">
            <button
              type="button"
              role="tab"
              aria-selected={aba === 'ativos'}
              className={'cc-lista__aba' + (aba === 'ativos' ? ' cc-lista__aba--ativa' : '')}
              onClick={() => trocarAba('ativos')}
            >
              Ativos
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={aba === 'finalizados'}
              className={'cc-lista__aba' + (aba === 'finalizados' ? ' cc-lista__aba--ativa' : '')}
              onClick={() => trocarAba('finalizados')}
            >
              Finalizados
            </button>
          </div>

          <div className="cc-lista__rolagem">
            {aba === 'ativos' ? (
              <>
                <ListaConversas
                  fila={fila.data ?? []}
                  carregando={fila.isLoading}
                  erro={fila.isError}
                  onTentarDeNovo={() => void fila.refetch()}
                  selecionado={clienteId == null ? chatId : null}
                  onSelecionar={selecionarChat}
                  onPegar={pegarChat}
                  pegando={pegar.isPending}
                  erroFila={erroFila}
                  filaAberta={config.data?.queue_open}
                  abreEm={config.data?.queue_opens_at}
                  limite={limite}
                  emAtendimento={emAtendimento}
                  agoraMs={agoraMs}
                />
                <ListaClientes
                  selecionado={clienteId}
                  onSelecionar={selecionarCliente}
                  agoraMs={agoraMs}
                />
              </>
            ) : (
              <Finalizados selecionado={chatId} onSelecionar={selecionarChat} />
            )}
          </div>
        </aside>
      )}

      {mostraConversa &&
        (clienteId != null && chatDaThread != null ? (
          /* key: trocar de pessoa remonta a thread — rascunho, busca e
             formulários de ação são de UMA conversa, não da tela */
          <ThreadDoCliente
            key={`thread-${clienteId}`}
            clienteId={clienteId}
            chatAtualId={chatDaThread}
            me={me}
            navegacao={navegacao}
          />
        ) : chatId != null ? (
          <ConversaChat key={`conversa-${chatId}`} chatId={chatId} me={me} navegacao={navegacao} />
        ) : (
          <SemSelecao>
            {fila.isLoading || clientes.isLoading ? (
              <EsqueletoConversa />
            ) : clientes.isError ? (
              <>
                <i className="ti ti-alert-triangle" aria-hidden="true" />
                <p>Não foi possível carregar as conversas.</p>
                <button type="button" className="cc-botao" onClick={() => void clientes.refetch()}>
                  <i className="ti ti-refresh" aria-hidden="true" /> Tentar de novo
                </button>
              </>
            ) : aba === 'finalizados' ? (
              <>
                <i className="ti ti-archive" aria-hidden="true" />
                <p>Escolha um atendimento encerrado na lista para reler a conversa.</p>
              </>
            ) : proximoDaFila ? (
              <>
                <i className="ti ti-inbox" aria-hidden="true" />
                <p>
                  {(fila.data?.length ?? 0) === 1
                    ? 'Uma pessoa esperando na fila.'
                    : `${fila.data?.length ?? 0} pessoas esperando na fila.`}{' '}
                  Pegue a próxima para começar, ou escolha uma conversa na lista.
                </p>
                <button
                  type="button"
                  className="cc-botao cc-botao--primario"
                  disabled={pegar.isPending || (limite != null && emAtendimento >= limite)}
                  onClick={() => pegarChat(proximoDaFila.id)}
                >
                  Pegar {proximoDaFila.client_name.split(' ')[0]}
                </button>
                {erroFila && (
                  <p className="cc-estado__erro" role="alert">
                    {erroFila}
                  </p>
                )}
              </>
            ) : (
              <>
                <i className="ti ti-message-circle-2" aria-hidden="true" />
                <p>
                  Nenhuma conversa em andamento. Quando alguém entrar na fila, aparece aqui, com
                  aviso sonoro se você estiver em outra aba.
                </p>
                <button type="button" className="cc-botao" onClick={() => trocarAba('finalizados')}>
                  Ver atendimentos finalizados
                </button>
              </>
            )}
          </SemSelecao>
        ))}

      {chatDoPainel != null &&
        (modo === 'tres' ? (
          <PainelChat key={`painel-${chatDoPainel}`} chatId={chatDoPainel} me={me} />
        ) : (
          detalhesAbertos && (
            <FolhaDeDetalhes onFechar={fecharDetalhes}>
              <PainelChat key={`painel-${chatDoPainel}`} chatId={chatDoPainel} me={me} />
            </FolhaDeDetalhes>
          )
        ))}
    </div>
  )
}

function SemSelecao({ children }: { children: ReactNode }) {
  return <section className="cc-conversa cc-conversa--estado">{children}</section>
}

/**
 * O painel do cliente como FOLHA, abaixo de 1200px: abre por cima da
 * conversa, pela direita, com véu atrás.
 *
 * É um diálogo de verdade: o foco entra nele ao abrir, Tab não escapa para a
 * conversa por baixo, Esc e o véu fecham, e ao fechar o foco volta para quem
 * abriu (o botão "Detalhes do cliente").
 */
function FolhaDeDetalhes({ onFechar, children }: { onFechar: () => void; children: ReactNode }) {
  const folha = useRef<HTMLDivElement>(null)
  // o fechar mais recente, sem refazer o efeito de foco a cada render (a
  // função muda de identidade toda vez que a página renderiza)
  const fechar = useRef(onFechar)
  useEffect(() => {
    fechar.current = onFechar
  })

  useEffect(() => {
    const quemAbriu = document.activeElement as HTMLElement | null
    folha.current?.querySelector<HTMLElement>('.cc-folha__fechar')?.focus()

    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        fechar.current()
        return
      }
      if (e.key !== 'Tab' || !folha.current) return
      const focaveis = folha.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focaveis.length === 0) return
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('keydown', tecla)
      quemAbriu?.focus?.()
    }
  }, [])

  return (
    <div className="cc-folha">
      <div className="cc-folha__veu" aria-hidden="true" onClick={onFechar} />
      <div
        ref={folha}
        className="cc-folha__caixa"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cc-folha-titulo"
      >
        <header className="cc-folha__cabecalho">
          <h2 id="cc-folha-titulo">Detalhes do cliente</h2>
          <button
            type="button"
            className="cc-icone cc-folha__fechar"
            aria-label="Fechar detalhes do cliente"
            data-dica="Fechar"
            onClick={onFechar}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
