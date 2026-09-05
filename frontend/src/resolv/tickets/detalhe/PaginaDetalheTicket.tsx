import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import type { Me } from '@/api/types'
import { useTabs } from '@/stores/tabs'
import { CabecalhoTicket, type PainelLateral } from './CabecalhoTicket'
import { Conversa } from './Conversa'
import { ModalFecharTicket } from './ModalFecharTicket'
import { PainelCliente } from './PainelCliente'
import { PainelPropriedades } from './PainelPropriedades'
import { TicketTabs } from './TicketTabs'
import { useAcoesTicket, useTicketDetalhe } from './dados'
import { mensagemDeErro } from './linhaDoTempo'
import type { TicketDetalhe } from './tiposDetalhe'
import './detalhe.scss'

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
}: {
  ticket: TicketDetalhe
  me: Me | undefined
  agoraMs: number
}) {
  const { atribuir, fechar } = useAcoesTicket(ticket.id)
  const [modalFechar, setModalFechar] = useState(false)
  const [pedidoReabrir, setPedidoReabrir] = useState(0)
  const [painelAberto, setPainelAberto] = useState<PainelLateral | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  return (
    <div className={'detalhe__miolo' + (painelAberto ? ` detalhe--gaveta-${painelAberto}` : '')}>
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
  const abrir = useTabs((s) => s.abrir)

  // Registra/atualiza a aba deste ticket assim que os dados chegam — é o que
  // alimenta a TicketTabs e o espelho no servidor (docs/06).
  useEffect(() => {
    if (!ticket) return
    abrir(ticket.id, {
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
      <TicketTabs idAtivo={ticketId} />

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
        <DetalheCarregado key={ticket.id} ticket={ticket} me={me} agoraMs={dataUpdatedAt} />
      )}
    </div>
  )
}
