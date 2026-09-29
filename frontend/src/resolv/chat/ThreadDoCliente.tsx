import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useMarcarThreadLida } from '@/api/chat'
import type { Me } from '@/api/types'
import {
  useConversaContinua,
  type MensagemLinhaDoTempo,
  type SessaoLinhaDoTempo,
} from '@/portal/api/chats'
import { Bolha, ConversaChat, type NavegacaoDaConversa } from './ConversaChat'
import { EsqueletoConversa } from './Esqueletos'
import { dataHoraDe } from './format'

/**
 * O histórico INTEIRO de um cliente numa rolagem só, para quem atende.
 *
 * Todas as aberturas daquela pessoa — atendimentos encerrados, o que virou
 * chamado, o que está em andamento — costurados numa thread contínua, com um
 * marcador discreto onde uma termina e a outra começa, no estilo dos
 * separadores de data de um mensageiro.
 *
 * Reaproveita a costura que já existia no portal (`useConversaContinua`),
 * agora apontando para `?client=`: era a mesma leitura, servida ao lado
 * errado.
 *
 * O que é de ANTES entra como prelúdio da conversa de agora, dentro da mesma
 * caixa de mensagens (`historico` do `ConversaChat`) — não como uma segunda
 * lista. Uma rolagem só, um compositor só, e todo o resto do console
 * (busca, anexos, macros, notas internas, encerramento) continua sendo o
 * mesmo código: a mudança é de APRESENTAÇÃO, não de comportamento.
 *
 * Escrever continua sendo na abertura viva — é ela que tem `can_send`. Sem
 * nenhuma aberta, `ConversaChat` já desenha "conversa encerrada" e esconde o
 * compositor: a thread fica em leitura sozinha, sem regra nova aqui.
 */
export function ThreadDoCliente({
  clienteId,
  chatAtualId,
  me,
  navegacao,
}: {
  clienteId: number
  /** A abertura VIVA do cliente, quando existe; senão a mais recente. É a
   *  que recebe mensagem nova e a que desenha o compositor. */
  chatAtualId: number
  me: Me | undefined
  /** Voltar e "Detalhes do cliente" do cabeçalho — repassado à conversa. */
  navegacao?: NavegacaoDaConversa
}) {
  const queryClient = useQueryClient()
  const [cursores, setCursores] = useState<(number | undefined)[]>([undefined])
  const { mensagens, sessoes, carregando, erro, temMais } = useConversaContinua(
    cursores,
    '',
    clienteId,
  )

  // O prelúdio é o que veio ANTES da abertura de agora: a conversa atual é
  // desenhada pelo `ConversaChat`, com socket, entrega e leitura — repeti-la
  // aqui seria a mesma mensagem duas vezes na tela.
  const anteriores = mensagens.filter((m) => m.chat_id !== chatAtualId)
  const sessaoPorId = new Map(sessoes.map((s) => [s.id, s]))
  const idsAnteriores: number[] = []
  for (const m of anteriores) {
    if (!idsAnteriores.includes(m.chat_id)) idsAnteriores.push(m.chat_id)
  }

  // O que está na tela foi lido — inclusive o histórico. A abertura de agora
  // é do `ConversaChat`; estas são as anteriores, e sem isto o contador da
  // caixa (que soma todas) ficaria travado num número impossível de zerar.
  const marcarThread = useMarcarThreadLida()
  const marcar = marcarThread.mutate
  const chaveDasAnteriores = idsAnteriores.join(',')
  useEffect(() => {
    if (!chaveDasAnteriores || document.hidden) return
    marcar(chaveDasAnteriores.split(',').map(Number))
    // `chaveDasAnteriores` é o conteúdo de `idsAnteriores`; a lista em si é
    // recriada a cada render e dispararia o efeito para sempre.
  }, [chaveDasAnteriores, marcar])

  const historico = (
    <div className="cc-thread__historico">
      {temMais && (
        <button
          type="button"
          className="cc-conversa__anteriores"
          onClick={() => setCursores((c) => [...c, mensagens[0]?.id])}
        >
          Carregar atendimentos anteriores
        </button>
      )}
      {carregando && mensagens.length === 0 && <EsqueletoConversa />}
      {erro != null && (
        <p className="cc-thread__erro" role="alert">
          Não foi possível carregar os atendimentos anteriores.{' '}
          {/* refaz só as páginas desta pessoa — a mesma chave que
              `useConversaContinua` monta (portal/api/chats.ts) */}
          <button
            type="button"
            className="cc-link"
            onClick={() =>
              void queryClient.refetchQueries({ queryKey: ['portal', 'chats', 'continua', clienteId] })
            }
          >
            Tentar de novo
          </button>
        </p>
      )}

      {idsAnteriores.map((id) => (
        <TrechoDeSessao
          key={id}
          sessao={sessaoPorId.get(id)}
          chatId={id}
          mensagens={anteriores.filter((m) => m.chat_id === id)}
          me={me}
        />
      ))}

      {/* onde começa a abertura de agora — o marcador vale mesmo sem
          histórico atrás: diz de qual protocolo é a conversa na tela */}
      <MarcoDeSessao sessao={sessaoPorId.get(chatAtualId)} chatId={chatAtualId} />
    </div>
  )

  return (
    <ConversaChat
      key={`thread-${chatAtualId}`}
      chatId={chatAtualId}
      me={me}
      historico={historico}
      navegacao={navegacao}
    />
  )
}

/** Um atendimento já encerrado dentro da rolagem: o marco de abertura, as
 *  mensagens e o fecho.
 *
 *  A bolha é a MESMA do `ConversaChat` — anexo, nota interna, citação e
 *  escada de entrega saem de graça, e não existe um segundo desenho de
 *  mensagem para divergir do primeiro. Sem `onResponder`: citar exige que a
 *  resposta seja do mesmo chat, e esta abertura já fechou.
 */
function TrechoDeSessao({
  sessao,
  chatId,
  mensagens,
  me,
}: {
  sessao: SessaoLinhaDoTempo | undefined
  chatId: number
  mensagens: MensagemLinhaDoTempo[]
  me: Me | undefined
}) {
  return (
    <>
      <MarcoDeSessao sessao={sessao} chatId={chatId} />
      {mensagens.map((m) => (
        <Bolha
          key={m.id}
          msg={m}
          ehMinha={me != null && m.author_is_internal === me.is_internal && !m.is_system}
        />
      ))}
      {sessao?.closed_at && <FechoDeSessao sessao={sessao} />}
    </>
  )
}

/**
 * O divisor entre uma abertura e a seguinte.
 *
 * Diz o protocolo, quem atendeu e quando — porque o responsável MUDA entre
 * aberturas, e sem isso duas conversas de agentes diferentes viram uma massa
 * só na rolagem. Não é editável nem clicável: é um marco do histórico, no
 * mesmo espírito do separador de data.
 */
function MarcoDeSessao({
  sessao,
  chatId,
}: {
  sessao: SessaoLinhaDoTempo | undefined
  chatId: number
}) {
  const quem = sessao?.agent_name
  return (
    <div className="cc-thread__marco" role="separator">
      <span>
        {sessao?.ticket_reference
          ? `Chamado ${sessao.ticket_reference} aberto`
          : `Atendimento #${chatId} aberto`}
        {sessao?.queued_at && ` · ${dataHoraDe(sessao.queued_at)}`}
        {/* quem atendeu MUDA de uma abertura para outra — é o que impede
            duas conversas de agentes diferentes de virarem uma massa só */}
        {quem && ` · assumido por ${quem}`}
      </span>
    </div>
  )
}

function FechoDeSessao({ sessao }: { sessao: SessaoLinhaDoTempo }) {
  return (
    <div className="cc-thread__marco" role="separator">
      <span>
        Atendimento encerrado
        {sessao.closed_at && ` · ${dataHoraDe(sessao.closed_at)}`}
        {sessao.close_reason_name && ` · ${sessao.close_reason_name}`}
        {sessao.rating && ` · nota ${sessao.rating.service_score}`}
      </span>
    </div>
  )
}
