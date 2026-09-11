import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  useCaixaDeClientes,
  useConfigChat,
  useFilaChat,
  useMeusChats,
  usePegarChat,
} from '@/api/chat'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { ConversaChat } from './ConversaChat'
import { Finalizados } from './Finalizados'
import { ListaClientes } from './ListaClientes'
import { ListaConversas } from './ListaConversas'
import { PainelChat } from './PainelChat'
import { ThreadDoCliente } from './ThreadDoCliente'
import './chat.scss'

/**
 * Console de chat do agente — rota própria (docs/07 F5), três colunas:
 * fila + conversas | a conversa | cliente e ações.
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
 * tem dono, e os finalizados). F5 ou link colado voltam pra mesma coisa.
 */
export function PaginaChat() {
  const [params, setParams] = useSearchParams()
  const chatParam = params.get('chat')
  const chatId = chatParam && /^\d+$/.test(chatParam) ? Number(chatParam) : null
  const clienteParam = params.get('cliente')
  const clienteId = clienteParam && /^\d+$/.test(clienteParam) ? Number(clienteParam) : null

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

  // sem seleção, cai na primeira conversa da caixa — é o que a pessoa estava
  // fazendo antes de sair da tela
  const primeiroCliente = clientes.data?.[0]?.client_id
  useEffect(() => {
    if (aba === 'ativos' && chatId == null && clienteId == null && primeiroCliente != null) {
      setParams({ cliente: String(primeiroCliente) }, { replace: true })
    }
  }, [aba, chatId, clienteId, primeiroCliente, setParams])

  /** Uma ABERTURA específica: a fila (ainda sem dono) e os finalizados. */
  function selecionarChat(id: number) {
    const proximo: Record<string, string> = { chat: String(id) }
    if (aba === 'finalizados') proximo.aba = 'finalizados'
    setParams(proximo)
  }

  /** Uma PESSOA: a thread com todo o histórico dela. */
  function selecionarCliente(id: number) {
    setParams({ cliente: String(id) })
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

  function pegarChat(id: number) {
    setErroFila(null)
    pegar.mutate(id, {
      // pegou: a conversa deixa de ser "uma abertura na fila" e passa a ser
      // "a conversa com aquela pessoa" — é na thread dela que ela continua
      onSuccess: (c) => setParams({ cliente: String(c.client_id) }),
      // perdeu a corrida ("já foi pego"), ou está no limite — o backend é
      // quem decide; a tela só repete o motivo e a lista se atualiza pelo
      // evento `chat_taken` que chega pra todo mundo
      onError: (e) => setErroFila(e instanceof ApiError ? (e.detail ?? 'Não foi possível pegar.') : 'Não foi possível pegar.'),
    })
  }

  // o painel da direita é sempre de UMA abertura — a da thread, ou a que
  // está selecionada avulsa: ficha, tags, encerramento e conversão são do
  // atendimento, não da pessoa
  const chatDoPainel = clienteId != null ? chatDaThread : chatId

  return (
    <div className="chat-console">
      <aside className="cc-lista" aria-label="Conversas">
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

        {aba === 'ativos' ? (
          <>
            <ListaConversas
              fila={fila.data ?? []}
              selecionado={clienteId == null ? chatId : null}
              onSelecionar={selecionarChat}
              onPegar={pegarChat}
              pegando={pegar.isPending}
              erroFila={erroFila}
              filaAberta={config.data?.queue_open}
              abreEm={config.data?.queue_opens_at}
              limite={config.data?.max_chats_per_agent}
              emAtendimento={meus.data?.length ?? 0}
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
      </aside>

      {clienteId != null && chatDaThread != null ? (
        /* key: trocar de pessoa remonta a thread — rascunho, busca e
           formulários de ação são de UMA conversa, não da tela */
        <ThreadDoCliente
          key={`thread-${clienteId}`}
          clienteId={clienteId}
          chatAtualId={chatDaThread}
          me={me}
        />
      ) : chatId != null ? (
        <ConversaChat key={`conversa-${chatId}`} chatId={chatId} me={me} />
      ) : (
        <section className="cc-conversa cc-conversa--estado">
          <i className="ti ti-message-circle-2" />
          <p>
            {fila.isLoading || clientes.isLoading
              ? 'Carregando…'
              : (fila.data?.length ?? 0) > 0
                ? 'Escolha um chat da fila para acompanhar, ou pegue um para atender.'
                : 'Nenhuma conversa em andamento. Quando um cliente entrar na fila, ela aparece aqui — e avisa com som se você estiver em outra aba.'}
          </p>
        </section>
      )}

      {chatDoPainel != null && (
        <PainelChat key={`painel-${chatDoPainel}`} chatId={chatDoPainel} me={me} />
      )}
    </div>
  )
}
