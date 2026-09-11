import type { QueryClient } from '@tanstack/react-query'
import {
  anexarMensagemNoCache,
  chaves,
  recuperarMensagensPerdidas,
  type Chat,
  type MensagemChat,
} from '@/api/chat'
import { criarSocket, type Socket } from './socket'
import type { EventoServidorChat, EventoServidorPessoal } from './types'

/**
 * "Eventos de socket são dicas; REST é a verdade" (docs/07-arquitetura-frontend.md).
 *
 * Duas exceções deliberadas, e só elas: a mensagem de chat que chega pela
 * sala (`message`/`message_edited`/`message_deleted`) e o `converted`. Nos
 * dois casos o payload É o registro serializado pelo backend, gravado ANTES
 * do broadcast — escrever direto no cache não é confiar no socket, é
 * poupar um round-trip para ler o que o próprio servidor acabou de mandar.
 * A reconexão continua buscando por REST o que ficou pra trás
 * (`recuperarMensagensPerdidas`): o socket entrega, não garante.
 */

let canalPessoal: Socket | null = null

type OuvinteDoCanalPessoal = (evento: EventoServidorPessoal) => void
const ouvintes = new Set<OuvinteDoCanalPessoal>()

/** Quem quer REAGIR a um evento pessoal (popup de fila, som em segundo
 *  plano) assina aqui, sem a bridge precisar conhecer a tela. */
export function assinarEventoPessoal(ouvinte: OuvinteDoCanalPessoal): () => void {
  ouvintes.add(ouvinte)
  return () => {
    ouvintes.delete(ouvinte)
  }
}

/** Singleton de verdade — mora fora do React. Chamar de novo (StrictMode
 *  roda efeitos duas vezes em dev; docs/07 registrou isso como bug medido
 *  quando o socket vivia dentro de um useEffect) só reencontra a conexão
 *  já aberta, nunca abre uma segunda. */
export function conectarCanalPessoal(queryClient: QueryClient): Socket {
  if (canalPessoal) return canalPessoal
  // "já esteve aberto" — distingue a primeira conexão (as queries iniciais
  // cobrem) de uma reconexão (o que mudou enquanto esteve fora não chegou)
  let jaAbriu = false
  canalPessoal = criarSocket<EventoServidorPessoal>({
    path: '/ws/me/',
    onEvento: (evento) => {
      aplicarEventoPessoal(evento, queryClient)
      for (const ouvinte of ouvintes) ouvinte(evento)
    },
    onStatus: (status) => {
      if (status !== 'aberto') return
      if (jaAbriu) {
        // O consumer reenvia a fila que já esperava ao conectar; o resto —
        // meus atendimentos, notificações, avaliações pendentes, tickets —
        // não tem reenvio. Sem isto, depois de uma queda a barra ficava
        // com o número velho até o refetchInterval de 30s.
        for (const chave of [chaves.fila, chaves.meus, chaves.meuVivo, chaves.pendentes]) {
          void queryClient.invalidateQueries({ queryKey: chave })
        }
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
        void queryClient.invalidateQueries({ queryKey: ['tickets'] })
      }
      jaAbriu = true
    },
  })
  return canalPessoal
}

/**
 * Chame no logout (explícito ou pela sessão expirando — `useLogout` e o
 * `aoDeslogar` de `client.ts`, os dois pontos de saída). Sem isto o
 * singleton acima sobrevivia à troca de usuário NA MESMA ABA: a pessoa B
 * logava por cima da pessoa A e `conectarCanalPessoal` devolvia o socket
 * antigo (autenticado pelo cookie que já não existe, tentando reconectar
 * sozinho) em vez de abrir um novo — o canal pessoal de B só voltava a
 * funcionar num F5. `ouvintes` fica intacto de propósito: quem assinou
 * ainda está montado (o shell só desmonta ao navegar pro /login) e cancela
 * a própria assinatura no cleanup do efeito dele.
 */
export function desconectarCanalPessoal(): void {
  canalPessoal?.desconectar()
  canalPessoal = null
}

/**
 * Kinds de notificação que mudam a LISTA de tickets E que nenhum outro evento
 * cobre. `broadcast_ticket_event` (apps/notifications/services/__init__.py)
 * só alcança solicitante/responsável/dono/seguidores do ticket, e o
 * `case 'ticket_event'` abaixo já revalida a fila para eles — quem recebe
 * `ticket_assigned`, `ticket_owner_set`, `ticket_replied`, `ticket_reopened`
 * ou `ticket_closed` está sempre nesse conjunto, então repetir a invalidação
 * aqui seria só um segundo GET da mesma lista. Sobram dois sem dono:
 *
 *  - `ticket_created` vai para os AGENTES DA EQUIPE
 *    (`ticket_service._notify_team_about_new_ticket`), que não são nem
 *    solicitante nem responsável de um chamado recém-aberto — não existe
 *    `ticket_event` na abertura. É o buraco que congelava a fila até o F5.
 *  - `sla_warning`/`sla_breached` saem da task periódica
 *    (`notifications/tasks.py::_alert`), sem broadcast nenhum, e o estado do
 *    relógio vem CALCULADO do servidor (`get_sla`, apps/tickets/serializers.py):
 *    sem refetch o sino avisa "estourado" com a coluna ainda em "2h restantes"
 *    e o filtro `sla=` continua mostrando o recorte velho.
 *
 * `mention` fica de fora porque ser citado cria `TicketWatcher`
 * (`tickets/services/mentions.py`) antes do broadcast da resposta — o
 * `ticket_event` chega junto.
 */
const KINDS_QUE_MUDAM_A_FILA = new Set(['ticket_created', 'sla_warning', 'sla_breached'])

function aplicarEventoPessoal(evento: EventoServidorPessoal, queryClient: QueryClient) {
  switch (evento.type) {
    case 'notification':
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      // `['tickets']` e não `['tickets', 'lista']`: o prefixo cobre a fila em
      // qualquer filtro (`['tickets', 'lista', params]`) E as contagens da
      // barra lateral (`['tickets', 'resumo']`). Invalidar só a lista deixava
      // a gaveta dizendo "Não atribuídos 40" com a fila já vazia.
      if (KINDS_QUE_MUDAM_A_FILA.has(evento.kind)) {
        queryClient.invalidateQueries({ queryKey: ['tickets'] })
      }
      if (evento.kind === 'chat_message' || evento.kind === 'chat_transferred' || evento.kind === 'chat_converted') {
        // badge/preview nas listas — a conversa aberta já recebe pela sala
        queryClient.invalidateQueries({ queryKey: chaves.meus })
        queryClient.invalidateQueries({ queryKey: chaves.meuVivo })
        if (evento.chat_id != null) {
          queryClient.invalidateQueries({ queryKey: chaves.chat(evento.chat_id), exact: true })
        }
      }
      break
    case 'ticket_event': {
      // Realtime de ticket (backend: broadcast_ticket_event). Dica, não
      // verdade: revalida o detalhe do ticket que mudou e a fila. A resposta
      // do cliente por e-mail aparece na conversa sem F5.
      queryClient.invalidateQueries({ queryKey: ['ticket', evento.ticket_id] })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      break
    }
    case 'chat_queued':
    case 'chat_taken':
      // a fila mudou (entrou alguém / alguém pegou / encerrou) — em TODO
      // agente, não só em quem clicou
      queryClient.invalidateQueries({ queryKey: chaves.fila })
      queryClient.invalidateQueries({ queryKey: chaves.meus })
      queryClient.invalidateQueries({ queryKey: chaves.meuVivo })
      break
    case 'agent_presence':
    case 'pong':
      break
  }
}

/**
 * O estado da sala mudou por ação de OUTRO ator (pegou, transferiu, encerrou,
 * converteu). O backend grava uma mensagem de sistema junto ("Atendimento
 * transferido de X para Y."), mas o evento só traz o estado — então o mesmo
 * catch-up por REST da reconexão (`?after=`) busca a mensagem e reconfere o
 * chat. Best-effort: se a rede falhar, invalida e o refetch normal resolve.
 */
function sincronizarSala(queryClient: QueryClient, chatId: number) {
  void recuperarMensagensPerdidas(queryClient, chatId).catch(() => {
    queryClient.invalidateQueries({ queryKey: chaves.mensagens(chatId) })
    queryClient.invalidateQueries({ queryKey: chaves.chat(chatId), exact: true })
  })
}

/**
 * Eventos de UMA sala de chat → cache. Nomes conferidos em
 * `apps/chat/consumers.py` (`ChatConsumer.chat_*`), não nos exemplos de docs/07.
 */
export function aplicarEventoChat(evento: EventoServidorChat, chatId: number, queryClient: QueryClient) {
  switch (evento.type) {
    case 'message':
    case 'message_edited':
    case 'message_deleted': {
      const { type: _tipo, ...mensagem } = evento
      anexarMensagemNoCache(queryClient, chatId, mensagem)
      break
    }
    case 'message_delivered':
    case 'message_read': {
      // O tique é do REMETENTE, e ele pode estar com a conversa aberta agora.
      // Carimba direto no cache em vez de invalidar: um refetch da thread
      // inteira para mudar um ícone rolaria a lista de quem está lendo.
      const campo = evento.type === 'message_read' ? 'read_at' : 'delivered_at'
      const quando = new Date().toISOString()
      queryClient.setQueryData<MensagemChat[]>(chaves.mensagens(chatId), (atual) =>
        atual?.map((m) =>
          evento.ids.includes(m.id) && m[campo] === null ? { ...m, [campo]: quando } : m,
        ),
      )
      break
    }
    case 'accepted':
    case 'transferred':
      sincronizarSala(queryClient, chatId)
      queryClient.invalidateQueries({ queryKey: chaves.fila })
      queryClient.invalidateQueries({ queryKey: chaves.meus })
      queryClient.invalidateQueries({ queryKey: chaves.meuVivo })
      break
    case 'closed':
      queryClient.setQueryData<Chat>(chaves.chat(chatId), (c) => (c ? { ...c, status: 'closed' } : c))
      sincronizarSala(queryClient, chatId)
      queryClient.invalidateQueries({ queryKey: chaves.fila })
      queryClient.invalidateQueries({ queryKey: chaves.meus })
      queryClient.invalidateQueries({ queryKey: chaves.meuVivo })
      // Encerrar pode travar chat novo até avaliar (pending-ratings).
      queryClient.invalidateQueries({ queryKey: chaves.pendentes })
      break
    case 'converted':
      // quem está com a conversa aberta vê o link do ticket na hora — o
      // evento carrega id e referência, sem esperar refetch
      queryClient.setQueryData<Chat>(chaves.chat(chatId), (c) =>
        c
          ? { ...c, status: 'closed', ticket_id: evento.ticket_id, ticket_reference: evento.ticket_reference }
          : c,
      )
      sincronizarSala(queryClient, chatId)
      queryClient.invalidateQueries({ queryKey: chaves.meus })
      queryClient.invalidateQueries({ queryKey: chaves.meuVivo })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      break
    case 'typing':
    case 'error':
    case 'pong':
      break // efêmero — indicador de digitação e erro não passam pelo cache
  }
}
