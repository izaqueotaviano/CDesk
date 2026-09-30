import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import type { Me } from '@/api/types'
import { useTabs } from '@/stores/tabs'
import { useAtalhos } from '../../atalhos/useAtalhos'
import { ROTULO_STATUS } from '../format'
import { CabecalhoTicket, type PainelLateral } from './CabecalhoTicket'
import { pedirCompositor } from './colaboracao/canalCompositor'
import { ContextoPresenca, primeiroNome } from './colaboracao/contexto'
import { usePresencaTicket } from './colaboracao/usePresencaTicket'
import { Conversa } from './Conversa'
import { ModalFecharTicket } from './ModalFecharTicket'
import { PainelCliente } from './PainelCliente'
import { PainelNotas } from './PainelNotas'
import { PainelPropriedades } from './PainelPropriedades'
import { requisicoesTicket, useTicketDetalhe } from './dados'
import type { TicketDetalhe } from './tiposDetalhe'
import { useAcaoAdiada } from './useAcaoAdiada'
import './detalhe.scss'

/** Retrato dos campos que a faixa de "atualizado por baixo" vigia — status,
 *  responsável e dono técnico (item 20). Fechamento/reabertura mexem em mais
 *  coisa (datas de resolução etc.), mas essas são estado LOCAL do Compositor
 *  e sobrevivem ao refetch sozinhas — não precisam de aviso. */
interface RetratoTicket {
  status: TicketDetalhe['status']
  assignee_id: number | null
  owner_id: number | null
}

function retratar(t: TicketDetalhe): RetratoTicket {
  return { status: t.status, assignee_id: t.assignee_id, owner_id: t.owner_id }
}

/**
 * Mensagem da faixa quando um refetch em segundo plano muda dado visível.
 *
 * Nomear quem mudou só quando dá para confiar na atribuição: o único autor
 * que o payload carrega é `events[].actor_name` (Evento, tiposDetalhe.ts), e
 * ele só corresponde ao que apareceu na tela quando o que mudou foi o STATUS
 * e o evento mais recente aponta para esse mesmo `to_status` — responsável e
 * dono técnico não têm "quem atribuiu" no TicketDetail, então nesses casos a
 * mensagem fica sem nome. Inventar autor aqui seria pior que omitir.
 */
function descreverAtualizacaoDeFundo(
  anterior: RetratoTicket,
  atual: TicketDetalhe,
): string | null {
  const statusMudou = anterior.status !== atual.status
  const responsavelMudou = anterior.assignee_id !== atual.assignee_id
  const donoMudou = anterior.owner_id !== atual.owner_id
  if (!statusMudou && !responsavelMudou && !donoMudou) return null

  if (statusMudou) {
    const maisRecente = [...atual.events].sort((a, b) => (a.created_at > b.created_at ? -1 : 1))[0]
    if (maisRecente?.actor_name && maisRecente.to_status === atual.status) {
      return `${maisRecente.actor_name} atualizou este ticket. O status agora é "${ROTULO_STATUS[atual.status]}".`
    }
  }
  return 'Este ticket foi atualizado enquanto você olhava.'
}

/** Placeholder com a forma da tela — a pessoa vê onde cada coisa vai
 *  aparecer em vez de um spinner no meio do nada. */
function Esqueleto() {
  return (
    <div className="detalhe__esqueleto" aria-busy="true" aria-label="Carregando ticket">
      <div className="esq esq--cabecalho">
        <span className="esq__bloco" style={{ width: 90 }} />
        <span className="esq__bloco" style={{ width: '40%' }} />
        <span className="esq__bloco esq__bloco--curto" style={{ width: 120, marginLeft: 'auto' }} />
      </div>
      <div className="detalhe__colunas">
        <div className="esq esq--coluna esq--props">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="esq__bloco esq__bloco--campo" />
          ))}
        </div>
        <div className="esq esq--coluna esq--conversa">
          {[0, 1, 2].map((i) => (
            <span key={i} className="esq__bloco esq__bloco--msg" />
          ))}
        </div>
        <div className="esq esq--coluna esq--cliente">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="esq__bloco esq__bloco--linha" />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Os tickets abertos, na ordem da barra de abas (as abas de página ficam de
 *  fora): é por eles que `[` e `]` andam. */
function vizinhosNaListaDeTrabalho(ids: number[], atual: number) {
  const i = ids.indexOf(atual)
  return {
    anterior: i > 0 ? ids[i - 1] : undefined,
    proximo: i >= 0 && i < ids.length - 1 ? ids[i + 1] : undefined,
  }
}

/**
 * Miolo da tela com o ticket já carregado. Montado com `key={ticket.id}`
 * pela página: trocar de ticket recria o componente, e gaveta, modal e
 * avisos recomeçam limpos sem efeito de "reset" — e a ação adiada que
 * estivesse esperando o "Desfazer" é gravada na saída (useAcaoAdiada).
 */
function DetalheCarregado({
  ticket: ticketDoServidor,
  me,
  agoraMs,
  buscandoEmSegundoPlano,
}: {
  ticket: TicketDetalhe
  me: Me | undefined
  agoraMs: number
  /** `isFetching` da query — true só durante um GET de verdade (refetch de
   *  60s/foco/socket). Ação própria grava com `setQueryData` (dados.ts,
   *  `gravar`) e nunca passa por aqui, então a transição true→false deste
   *  flag é o sinal de "isto veio de fora", não de "eu acabei de salvar". */
  buscandoEmSegundoPlano: boolean
}) {
  const navigate = useNavigate()
  const acoes = useAcaoAdiada(ticketDoServidor.id)
  // O que a tela mostra: o ticket do servidor com a ação que espera o
  // "Desfazer" por cima. Sobreposição e não escrita no cache: um refetch no
  // meio da espera (socket, foco, 60s) traria o estado velho de volta e o
  // ticket "reabriria" sozinho na frente da pessoa.
  const ticket = useMemo(
    () => (acoes.previa ? { ...ticketDoServidor, ...acoes.previa } : ticketDoServidor),
    [ticketDoServidor, acoes.previa],
  )
  const presentes = usePresencaTicket(ticket.id, me?.id, me?.is_internal === true)
  // string e não lista: o seletor devolve um valor comparável por igualdade,
  // e a tela não re-renderiza a cada rascunho gravado nas abas
  const idsDeTrabalho = useTabs((s) =>
    s.tabs.flatMap((a) => (a.tipo === 'ticket' ? [a.ticketId] : [])).join(','),
  )
  const [modalFechar, setModalFechar] = useState(false)
  const [pedidoReabrir, setPedidoReabrir] = useState(0)
  const [painelAberto, setPainelAberto] = useState<PainelLateral | null>(null)
  const [avisoAtualizacao, setAvisoAtualizacao] = useState<string | null>(null)

  // Retrato do ticket ANTES do render corrente e se a busca estava em voo no
  // render anterior — comparados dentro do efeito para pegar a transição
  // true→false (fetch que acabou de chegar). Nasce do próprio ticket/estado
  // atuais (não de `undefined`) porque este componente é remontado com
  // `key={ticket.id}` a cada troca de aba (comentário da página) — sem isso a
  // primeira renderização de CADA ticket comparia contra "nada" e nunca
  // dispararia por acidente, mas documentar o porquê evita "corrigir" para
  // `useRef<RetratoTicket | null>(null)` e reintroduzir o falso positivo.
  // Vigia o ticket do SERVIDOR: a prévia de uma ação própria não é "mudou
  // por baixo".
  const retratoAnterior = useRef<RetratoTicket>(retratar(ticketDoServidor))
  const buscavaAntes = useRef(buscandoEmSegundoPlano)

  useEffect(() => {
    if (buscavaAntes.current && !buscandoEmSegundoPlano) {
      const mensagem = descreverAtualizacaoDeFundo(retratoAnterior.current, ticketDoServidor)
      if (mensagem) setAvisoAtualizacao(mensagem)
    }
    buscavaAntes.current = buscandoEmSegundoPlano
    retratoAnterior.current = retratar(ticketDoServidor)
  }, [ticketDoServidor, buscandoEmSegundoPlano])

  const perms = me?.permissions ?? []
  const fechado = ticket.status === 'closed'
  const souOResponsavel = me != null && ticket.assignee_id === me.id
  const podeAssumir = !fechado && !souOResponsavel && perms.includes('ticket.be_assigned')
  const podeFechar = !fechado && perms.includes('ticket.close')

  /** Assumir vai com "Desfazer", não com "tem certeza?" — inclusive tirando
   *  de um colega: nada sai para o servidor antes do prazo, então desfazer
   *  não notifica ninguém. */
  function assumir() {
    if (!me || !podeAssumir) return
    const de = ticket.assignee_id != null ? (ticket.assignee_name ?? 'outro responsável') : null
    acoes.agendar({
      titulo: de ? `Você assumiu de ${primeiroNome(de)}` : 'Ticket atribuído a você',
      descricao: de ? `${de} deixa de ser o responsável.` : undefined,
      previa: { assignee_id: me.id, assignee_name: me.full_name },
      executar: (opcoes) => requisicoesTicket.atribuir(ticket.id, me.id, opcoes),
      erro: 'Não foi possível assumir o ticket.',
    })
  }

  const { anterior, proximo } = vizinhosNaListaDeTrabalho(
    idsDeTrabalho ? idsDeTrabalho.split(',').map(Number) : [],
    ticket.id,
  )

  // Atalhos do grupo "Ticket aberto" (atalhos/catalogo.ts). Ação que a
  // pessoa não pode fazer aqui não registra — a tecla fica sem efeito em vez
  // de abrir algo que o servidor recusaria.
  useAtalhos({
    'ticket.responder': ticket.content_hidden
      ? undefined
      : () => pedirCompositor(ticket.id, 'resposta'),
    'ticket.nota': ticket.content_hidden ? undefined : () => pedirCompositor(ticket.id, 'nota'),
    'ticket.atribuir': podeAssumir ? assumir : undefined,
    'ticket.encerrar': podeFechar ? () => setModalFechar(true) : undefined,
    'ticket.anterior': anterior !== undefined ? () => navigate(`/tickets/${anterior}`) : undefined,
    'ticket.proximo': proximo !== undefined ? () => navigate(`/tickets/${proximo}`) : undefined,
    'geral.fechar': painelAberto ? () => setPainelAberto(null) : undefined,
  })

  return (
    <ContextoPresenca.Provider value={presentes}>
      <div className={'detalhe__miolo' + (painelAberto ? ` detalhe--gaveta-${painelAberto}` : '')}>
        {avisoAtualizacao && (
          <p className="detalhe__aviso-atualizacao" role="status" aria-live="polite">
            <i className="ti ti-refresh-alert" aria-hidden="true" />
            <span>{avisoAtualizacao}</span>
            <button
              type="button"
              onClick={() => setAvisoAtualizacao(null)}
              aria-label="Fechar aviso de atualização"
            >
              <i className="ti ti-x" />
            </button>
          </p>
        )}

        <CabecalhoTicket
          ticket={ticket}
          me={me}
          onAssumir={assumir}
          onFechar={() => setModalFechar(true)}
          onReabrir={() => {
            // Fechamento ainda esperando o prazo: "Reabrir…" é desfazê-lo —
            // nada foi gravado, então não há o que reabrir no servidor.
            if (acoes.previa?.status === 'closed') acoes.desfazer()
            else setPedidoReabrir((n) => n + 1)
          }}
          painelAberto={painelAberto}
          onAlternarPainel={(p) => setPainelAberto((atual) => (atual === p ? null : p))}
        />

        {ticket.content_hidden ? (
          <div className="detalhe__estado detalhe__estado--restrito">
            <i className="ti ti-lock" aria-hidden="true" />
            <p className="detalhe__estado-titulo">
              O conteúdo deste ticket pertence a uma equipe restrita e está oculto para o seu
              perfil.
            </p>
            <p>
              {ticket.restriction_reason ||
                `Peça acesso a um supervisor${ticket.team ? ` da equipe ${ticket.team.name}` : ''} se precisar atuar nele.`}
            </p>
          </div>
        ) : (
          <div className="detalhe__colunas">
            <PainelPropriedades ticket={ticket} me={me} />
            <Conversa ticket={ticket} me={me} agoraMs={agoraMs} pedidoReabrir={pedidoReabrir} />
            <PainelCliente ticket={ticket} agoraMs={agoraMs} />
            {painelAberto === 'notas' && (
              <PainelNotas
                ticketId={ticket.id}
                agoraMs={agoraMs}
                onFechar={() => setPainelAberto(null)}
              />
            )}
            {/* Sem véu para as notas: o painel existe para anotar ENQUANTO se lê o
             *  chamado. Um véu clicável cobrindo a conversa faria o clique de
             *  rolar/ler fechar o painel — e levar junto o rascunho não salvo.
             *  Propriedades e cliente mantêm o véu: ali o painel só vira gaveta
             *  quando a tela é estreita, e aí ele é mesmo modal. */}
            {painelAberto && painelAberto !== 'notas' && (
              <button
                type="button"
                className="detalhe__veu"
                aria-label="Fechar painel"
                onClick={() => setPainelAberto(null)}
              />
            )}
          </div>
        )}

        {modalFechar && (
          <ModalFecharTicket
            ticket={ticket}
            onFechar={(dados) => {
              // Fechar não sai na hora: vai com "Desfazer" (useAcaoAdiada).
              // Desfazer um fechamento JÁ gravado seria reabrir — nota
              // obrigatória, e-mail ao cliente, ciclo novo de SLA —, então o
              // que se adia é o envio, não o efeito.
              setModalFechar(false)
              acoes.agendar({
                titulo: 'Ticket fechado',
                descricao: dados.note ? `Justificativa: ${dados.note}` : undefined,
                previa: {
                  status: 'closed',
                  stage_name: ROTULO_STATUS.closed,
                  stage_color: 'var(--ok)',
                  closed_at: new Date().toISOString(),
                  resolution_started_at: dados.resolution_started_at,
                  resolution_ended_at: dados.resolution_ended_at,
                },
                executar: (opcoes) => requisicoesTicket.fechar(ticket.id, dados, opcoes),
                erro: 'Não foi possível fechar o ticket.',
              })
            }}
            onCancelar={() => setModalFechar(false)}
          />
        )}
      </div>
    </ContextoPresenca.Provider>
  )
}

export function PaginaDetalheTicket() {
  const { id } = useParams<{ id: string }>()
  const ticketId = Number(id)
  const navigate = useNavigate()
  const {
    data: ticket,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useTicketDetalhe(ticketId)
  const { data: me } = useMe()
  const abrirTicket = useTabs((s) => s.abrirTicket)

  // Registra/atualiza a aba deste ticket assim que os dados chegam — é o que
  // alimenta a aba do ticket na barra do topo e o espelho no servidor (docs/06).
  useEffect(() => {
    if (!ticket) return
    abrirTicket(ticket.id, {
      id: ticket.id,
      reference: ticket.reference,
      subject: ticket.subject,
      status: ticket.status,
      stage_color: ticket.stage_color,
      requester_display: ticket.requester_display,
      company_name: ticket.company_name,
    })
    // só quando o id/identidade muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, ticket?.reference, ticket?.subject])

  return (
    <div className="detalhe">
      {/* Sem role="tabpanel": as abas do topo trocam de ROTA, e o painel delas é
          a página inteira (o <main> do shell). Um tabpanel aqui esconderia o
          marco principal do leitor de tela dentro de um marco que ele não
          nomeia. */}
      <div className="detalhe__painel">

      {isError ? (
        <div className="detalhe__estado detalhe__estado--erro" role="alert">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <p className="detalhe__estado-titulo">
            {error instanceof ApiError && error.status === 404
              ? 'Este ticket não existe ou você não tem acesso a ele.'
              : `Não foi possível carregar o ticket${error instanceof ApiError ? ` (erro ${error.status})` : ''}.`}
          </p>
          <p>Nenhum dado foi perdido. Tente de novo ou volte para a lista.</p>
          <div className="detalhe__estado-acoes">
            <button
              type="button"
              className="detalhe__botao detalhe__botao--primario"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? 'Tentando…' : 'Tentar de novo'}
            </button>
            <button type="button" className="detalhe__botao" onClick={() => navigate('/tickets')}>
              Voltar para a lista
            </button>
          </div>
        </div>
      ) : isLoading || !ticket ? (
        <Esqueleto />
      ) : (
        // Referência de "agora" para tempos relativos e hora local: o instante
        // do último fetch, determinístico — não Date.now() em render.
        <DetalheCarregado
          key={ticket.id}
          ticket={ticket}
          me={me}
          agoraMs={dataUpdatedAt}
          buscandoEmSegundoPlano={isFetching}
        />
      )}
      </div>
    </div>
  )
}
