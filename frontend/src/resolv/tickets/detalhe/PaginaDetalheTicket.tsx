import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import type { Me } from '@/api/types'
import { useTabs } from '@/stores/tabs'
import { ROTULO_STATUS } from '../format'
import { CabecalhoTicket, type PainelLateral } from './CabecalhoTicket'
import { Conversa } from './Conversa'
import { ModalFecharTicket } from './ModalFecharTicket'
import { PainelCliente } from './PainelCliente'
import { PainelPropriedades } from './PainelPropriedades'
import { useAcoesTicket, useTicketDetalhe } from './dados'
import { mensagemDeErro } from './linhaDoTempo'
import type { TicketDetalhe } from './tiposDetalhe'
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
      return `${maisRecente.actor_name} atualizou este chamado — status agora é "${ROTULO_STATUS[atual.status]}".`
    }
  }
  return 'Este chamado foi atualizado enquanto você olhava.'
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

/**
 * Miolo da tela com o ticket já carregado. Montado com `key={ticket.id}`
 * pela página: trocar de ticket recria o componente, e gaveta, modal e
 * avisos recomeçam limpos sem efeito de "reset".
 */
function DetalheCarregado({
  ticket,
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
  const { atribuir, fechar } = useAcoesTicket(ticket.id)
  const [modalFechar, setModalFechar] = useState(false)
  const [pedidoReabrir, setPedidoReabrir] = useState(0)
  const [painelAberto, setPainelAberto] = useState<PainelLateral | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [avisoAtualizacao, setAvisoAtualizacao] = useState<string | null>(null)

  // Retrato do ticket ANTES do render corrente e se a busca estava em voo no
  // render anterior — comparados dentro do efeito para pegar a transição
  // true→false (fetch que acabou de chegar). Nasce do próprio ticket/estado
  // atuais (não de `undefined`) porque este componente é remontado com
  // `key={ticket.id}` a cada troca de aba (comentário da página) — sem isso a
  // primeira renderização de CADA ticket comparia contra "nada" e nunca
  // dispararia por acidente, mas documentar o porquê evita "corrigir" para
  // `useRef<RetratoTicket | null>(null)` e reintroduzir o falso positivo.
  const retratoAnterior = useRef<RetratoTicket>(retratar(ticket))
  const buscavaAntes = useRef(buscandoEmSegundoPlano)

  useEffect(() => {
    if (buscavaAntes.current && !buscandoEmSegundoPlano) {
      const mensagem = descreverAtualizacaoDeFundo(retratoAnterior.current, ticket)
      if (mensagem) setAvisoAtualizacao(mensagem)
    }
    buscavaAntes.current = buscandoEmSegundoPlano
    retratoAnterior.current = retratar(ticket)
  }, [ticket, buscandoEmSegundoPlano])

  return (
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
        assumindo={atribuir.isPending}
        onAssumir={() => {
          if (!me) return
          setErroAcao(null)
          atribuir.mutate(me.id, {
            onError: (e) =>
              setErroAcao(
                `${mensagemDeErro(e, 'Não foi possível assumir o ticket.')} Nada foi alterado.`,
              ),
          })
        }}
        onFechar={() => setModalFechar(true)}
        onReabrir={() => setPedidoReabrir((n) => n + 1)}
        painelAberto={painelAberto}
        onAlternarPainel={(p) => setPainelAberto((atual) => (atual === p ? null : p))}
      />

      {erroAcao && (
        <p className="detalhe__erro-acao" role="alert">
          <i className="ti ti-alert-circle" aria-hidden="true" />
          <span>{erroAcao}</span>
          <button type="button" onClick={() => setErroAcao(null)} aria-label="Fechar aviso">
            <i className="ti ti-x" />
          </button>
        </p>
      )}

      {ticket.content_hidden ? (
        <div className="detalhe__estado detalhe__estado--restrito">
          <i className="ti ti-lock" aria-hidden="true" />
          <p className="detalhe__estado-titulo">
            O conteúdo deste ticket pertence a uma equipe restrita e está oculto para o seu perfil.
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
          {painelAberto && (
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
          enviando={fechar.isPending}
          onFechar={async (dados) => {
            await fechar.mutateAsync(dados)
            setModalFechar(false)
          }}
          onCancelar={() => setModalFechar(false)}
        />
      )}
    </div>
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
  // alimenta a BarraDeAbas e o espelho no servidor (docs/06).
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
      {/* O painel que a aba ativa controla — único elemento com esse papel na
          árvore (trocar de aba navega para outra rota, não empilha um segundo
          painel ao lado). `aria-labelledby` aponta para o id que a barra de
          abas do shell expõe por aba de ticket (`aba-tab-${ticketId}`,
          resolv/shell/BarraDeAbas.tsx — a barra migrou pra lá na Fase 2, fora
          desta página, porque agora cobre seções também, não só tickets); o
          vínculo completa o padrão WAI-ARIA de tabs — a aba já era role="tab"
          e navegável, só não dizia qual painel ela abre. */}
      <div
        role="tabpanel"
        id="detalhe-painel-ticket"
        aria-labelledby={`aba-tab-${ticketId}`}
        className="detalhe__painel"
      >

      {isError ? (
        <div className="detalhe__estado detalhe__estado--erro" role="alert">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <p className="detalhe__estado-titulo">
            {error instanceof ApiError && error.status === 404
              ? 'Este ticket não existe ou você não tem acesso a ele.'
              : `Não foi possível carregar o ticket${error instanceof ApiError ? ` (erro ${error.status})` : ''}.`}
          </p>
          <p>Nenhum dado foi perdido — tente de novo ou volte para a lista.</p>
          <div className="detalhe__estado-acoes">
            <button
              type="button"
              className="detalhe__botao detalhe__botao--primario"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? 'Tentando…' : 'Tentar de novo'}
            </button>
            <button type="button" className="detalhe__botao" onClick={() => navigate('/chamados')}>
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
