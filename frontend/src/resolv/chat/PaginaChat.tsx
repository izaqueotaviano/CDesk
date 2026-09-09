import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useConfigChat, useFilaChat, useMeusChats, usePegarChat } from '@/api/chat'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { ConversaChat } from './ConversaChat'
import { Finalizados } from './Finalizados'
import { ListaConversas } from './ListaConversas'
import { PainelChat } from './PainelChat'
import './chat.scss'

/**
 * Console de chat do agente — rota própria (docs/07 F5), três colunas:
 * fila + meus atendimentos | a conversa | cliente e ações.
 *
 * O chat selecionado mora na URL (`?chat=<id>`), como a aba de
 * Configurações: F5 ou link colado voltam pra mesma conversa.
 */
export function PaginaChat() {
  const [params, setParams] = useSearchParams()
  const chatParam = params.get('chat')
  const chatId = chatParam && /^\d+$/.test(chatParam) ? Number(chatParam) : null

  const { data: me } = useMe()
  const fila = useFilaChat()
  const meus = useMeusChats()
  const config = useConfigChat()
  const pegar = usePegarChat()
  const [erroFila, setErroFila] = useState<string | null>(null)
  // "Ativos" (fila + meus) ou "Finalizados". Mora na URL como a conversa:
  // recarregar a página não devolve a pessoa para a aba errada.
  const aba = params.get('aba') === 'finalizados' ? 'finalizados' : 'ativos'

  // "agora" de referência para os tempos relativos — o instante do último
  // fetch da fila, não Date.now() em render (impuro; recalcularia à toa)
  const agoraMs = Math.max(fila.dataUpdatedAt, meus.dataUpdatedAt) || 0

  // sem seleção, cai no primeiro atendimento em andamento
  const primeiroMeu = meus.data?.[0]?.id
  useEffect(() => {
    if (aba === 'ativos' && chatId == null && primeiroMeu != null) {
      setParams({ chat: String(primeiroMeu) }, { replace: true })
    }
  }, [aba, chatId, primeiroMeu, setParams])

  function selecionar(id: number) {
    const proximo: Record<string, string> = { chat: String(id) }
    if (aba === 'finalizados') proximo.aba = 'finalizados'
    setParams(proximo)
  }

  function trocarAba(proxima: 'ativos' | 'finalizados') {
    const atual: Record<string, string> = {}
    if (chatParam) atual.chat = chatParam
    if (proxima === 'finalizados') atual.aba = 'finalizados'
    setParams(atual)
  }

  function pegarChat(id: number) {
    setErroFila(null)
    pegar.mutate(id, {
      onSuccess: (c) => selecionar(c.id),
      // perdeu a corrida ("já foi pego"), ou está no limite — o backend é
      // quem decide; a tela só repete o motivo e a lista se atualiza pelo
      // evento `chat_taken` que chega pra todo mundo
      onError: (e) => setErroFila(e instanceof ApiError ? (e.detail ?? 'Não foi possível pegar.') : 'Não foi possível pegar.'),
    })
  }

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
          <ListaConversas
            fila={fila.data ?? []}
            meus={meus.data ?? []}
            selecionado={chatId}
            onSelecionar={selecionar}
            onPegar={pegarChat}
            pegando={pegar.isPending}
            erroFila={erroFila}
            filaAberta={config.data?.queue_open}
            abreEm={config.data?.queue_opens_at}
            limite={config.data?.max_chats_per_agent}
            agoraMs={agoraMs}
          />
        ) : (
          <Finalizados selecionado={chatId} onSelecionar={selecionar} />
        )}
      </aside>

      {chatId != null ? (
        <>
          {/* key: trocar de conversa remonta os dois — estado de rascunho,
              erro e formulários de ação são de UMA conversa, não da tela */}
          <ConversaChat key={`conversa-${chatId}`} chatId={chatId} me={me} />
          <PainelChat key={`painel-${chatId}`} chatId={chatId} me={me} />
        </>
      ) : (
        <section className="cc-conversa cc-conversa--estado">
          <i className="ti ti-message-circle-2" />
          <p>
            {fila.isLoading || meus.isLoading
              ? 'Carregando…'
              : (fila.data?.length ?? 0) > 0
                ? 'Escolha um chat da fila para acompanhar, ou pegue um para atender.'
                : 'Nenhuma conversa em andamento. Quando um cliente entrar na fila, ela aparece aqui — e avisa com som se você estiver em outra aba.'}
          </p>
        </section>
      )}
    </div>
  )
}
