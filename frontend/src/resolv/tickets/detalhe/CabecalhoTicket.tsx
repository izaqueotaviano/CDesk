import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '@/api/client'
import type { Me } from '@/api/types'
// A transcrição em PDF já estava escrita para o portal e vai por fetch+blob de
// propósito: o endpoint devolve 501 quando o gerador não está instalado
// (apps/tickets/views.py, `export`), e um <a download> transformaria isso numa
// aba em branco. Reusar > reescrever — resolv/conta já importa de @/portal.
import { baixarPdfDoTicket } from '@/portal/api/tickets'
import { COR_PRIORIDADE, ROTULO_PRIORIDADE, formatarDataHora } from '../format'
import {
  ICONE_CANAL,
  ROTULO_CANAL,
  ROTULO_SLA,
  TOM_SLA,
  mensagemDeErro,
  tempoSla,
} from './linhaDoTempo'
import { PresencaTicket } from './colaboracao/PresencaTicket'
import type { RelogioSla, TicketDetalhe } from './tiposDetalhe'

/**
 * `propriedades` e `cliente` são COLUNAS que só viram gaveta quando a tela
 * aperta (media queries em detalhe.scss). `notas` nunca é coluna: é o
 * rascunho pessoal de quem atende, abre sob demanda em qualquer largura e
 * some quando fecha — por isso o botão dele fica junto das ações, sempre
 * visível, e não no grupo `__gavetas`, que só aparece abaixo de 1100px.
 */
export type PainelLateral = 'propriedades' | 'cliente' | 'notas'

interface Props {
  ticket: TicketDetalhe
  me: Me | undefined
  /** Assume na hora na tela, com "Desfazer" no aviso (useAcaoAdiada) — por
   *  isso não há mais "tem certeza?" nem estado de "Assumindo…" aqui. */
  onAssumir: () => void
  onFechar: () => void
  onReabrir: () => void
  /** Em telas estreitas os painéis laterais viram gavetas — o cabeçalho é
   *  quem abre cada uma. */
  painelAberto: PainelLateral | null
  onAlternarPainel: (p: PainelLateral) => void
}

function RelogioSlaChip({ rotulo, relogio }: { rotulo: string; relogio: RelogioSla }) {
  const tom = TOM_SLA[relogio.state]
  const prazo = relogio.due_at ? `Prazo: ${formatarDataHora(relogio.due_at)}` : 'Sem prazo definido'
  return (
    <span className={`ticket-cab__sla ticket-cab__sla--${tom}`} title={prazo}>
      <span className="ticket-cab__sla-rotulo">{rotulo}</span>
      <span className="ticket-cab__sla-valor">{tempoSla(relogio)}</span>
      <span className="ticket-cab__sla-estado">{ROTULO_SLA[relogio.state]}</span>
    </span>
  )
}

/**
 * Identidade do ticket + as ações que a pessoa mais procura ao abrir a tela:
 * assumir e fechar/reabrir. Antes, fechar só existia escondido num menu do
 * botão de enviar — e falhava no backend, que exige as datas da solução (D4).
 * Agora é um botão com nome, que abre o formulário certo. "Seguir" fica no
 * painel de propriedades, junto da lista de quem já segue.
 */
export function CabecalhoTicket({
  ticket,
  me,
  onAssumir,
  onFechar,
  onReabrir,
  painelAberto,
  onAlternarPainel,
}: Props) {
  const navigate = useNavigate()
  const [exportando, setExportando] = useState(false)
  const [avisoExport, setAvisoExport] = useState<string | null>(null)
  const perms = me?.permissions ?? []
  const fechado = ticket.status === 'closed'
  const souOResponsavel = me != null && ticket.assignee_id === me.id
  const podeAssumir = !fechado && !souOResponsavel && perms.includes('ticket.be_assigned')
  const podeFechar = perms.includes('ticket.close')
  const podeReabrir = perms.includes('ticket.reply_public')

  // `assignee_id` é quem manda: o nome é derivado dele no serializer, e ler o
  // nome primeiro faria um responsável sem nome cadastrado sumir da tela.
  const nomeDoResponsavel =
    ticket.assignee_id != null ? (ticket.assignee_name ?? 'outro responsável') : null

  // Assumir com dono é TIRAR de um colega, não pegar um chamado solto — o
  // botão diz de quem. Não pergunta antes: a troca só sai depois do prazo do
  // "Desfazer", então errar custa um clique, não uma notificação ao colega.
  const donoAtual = souOResponsavel ? null : nomeDoResponsavel
  // Primeiro nome no botão, que divide a barra com "Fechar ticket…"; o nome
  // inteiro vai no `title` e no aviso de "Desfazer".
  const primeiroNome = donoAtual?.trim().split(/\s+/)[0] ?? ''

  async function exportarPdf() {
    setExportando(true)
    setAvisoExport(null)
    try {
      await baixarPdfDoTicket(ticket.id, ticket.reference)
    } catch (e) {
      setAvisoExport(
        e instanceof ApiError && e.status === 501
          ? 'A exportação em PDF não está disponível neste servidor. Nada foi baixado.'
          : `${mensagemDeErro(e, 'Não foi possível gerar o PDF.')} Nada foi baixado.`,
      )
    } finally {
      setExportando(false)
    }
  }

  return (
    <header className="ticket-cab">
      <div className="ticket-cab__linha">
        <button
          type="button"
          className="ticket-cab__voltar"
          onClick={() => navigate('/chamados')}
          aria-label="Voltar para a lista de tickets"
          title="Voltar para a lista"
        >
          <i className="ti ti-arrow-left" />
        </button>

        <div className="ticket-cab__identidade">
          <span className="ticket-cab__ref">{ticket.reference}</span>
          <h1 className="ticket-cab__assunto">
            {ticket.is_restricted && (
              <i className="ti ti-lock" title="Equipe restrita" aria-label="Equipe restrita" />
            )}
            {ticket.subject}
          </h1>
        </div>

        {/* Quem mais está com este ticket aberto — some quando ninguém está */}
        <PresencaTicket />

        <div className="ticket-cab__acoes">
          {podeAssumir && (
            <button
              type="button"
              className="ticket-cab__botao"
              onClick={onAssumir}
              title={donoAtual ? `Tirar de ${donoAtual} e assumir (a)` : 'Atribuir a você (a)'}
              aria-keyshortcuts="a"
            >
              <i className="ti ti-user-check" aria-hidden="true" />
              {/* no celular o rótulo vira só texto de leitor de tela (detalhe.scss) */}
              <span className="ticket-cab__rotulo">
                {donoAtual ? `Assumir de ${primeiroNome}` : 'Assumir'}
              </span>
            </button>
          )}

          {/* Ação de vez em quando: só ícone, com o nome no rótulo acessível e
              no `title` — a barra fica com as ações do dia a dia por extenso. */}
          <button
            type="button"
            className="ticket-cab__icone"
            onClick={exportarPdf}
            disabled={exportando || ticket.content_hidden}
            aria-label={exportando ? 'Gerando o PDF…' : 'Exportar a conversa em PDF'}
            title={exportando ? 'Gerando o PDF…' : 'Exportar a conversa em PDF'}
          >
            <i
              className={exportando ? 'ti ti-loader-2 ticket-cab__girando' : 'ti ti-download'}
              aria-hidden="true"
            />
          </button>
          {fechado
            ? podeReabrir && (
                <button type="button" className="ticket-cab__botao" onClick={onReabrir}>
                  <i className="ti ti-rotate-clockwise-2" aria-hidden="true" />
                  <span className="ticket-cab__rotulo">Reabrir…</span>
                </button>
              )
            : podeFechar && (
                <button
                  type="button"
                  className="ticket-cab__botao ticket-cab__botao--primario"
                  onClick={onFechar}
                  title="Fechar ticket (e)"
                  aria-keyshortcuts="e"
                >
                  <i className="ti ti-circle-check" aria-hidden="true" />
                  <span className="ticket-cab__rotulo">Fechar ticket…</span>
                </button>
              )}

          <button
            type="button"
            className={
              'ticket-cab__botao' + (painelAberto === 'notas' ? ' ticket-cab__botao--ativo' : '')
            }
            onClick={() => onAlternarPainel('notas')}
            aria-pressed={painelAberto === 'notas'}
            title="Suas anotações sobre este chamado (só você vê)"
          >
            <i className="ti ti-notes" aria-hidden="true" />
            <span className="ticket-cab__rotulo">Notas</span>
          </button>

          <span className="ticket-cab__gavetas" role="group" aria-label="Painéis">
            <button
              type="button"
              className={
                'ticket-cab__gaveta ticket-cab__gaveta--props' +
                (painelAberto === 'propriedades' ? ' ticket-cab__gaveta--ativa' : '')
              }
              onClick={() => onAlternarPainel('propriedades')}
              aria-pressed={painelAberto === 'propriedades'}
              aria-label="Propriedades do ticket"
              title="Propriedades"
            >
              <i className="ti ti-adjustments-horizontal" />
            </button>
            <button
              type="button"
              className={
                'ticket-cab__gaveta ticket-cab__gaveta--cliente' +
                (painelAberto === 'cliente' ? ' ticket-cab__gaveta--ativa' : '')
              }
              onClick={() => onAlternarPainel('cliente')}
              aria-pressed={painelAberto === 'cliente'}
              aria-label="Dados do cliente"
              title="Cliente"
            >
              <i className="ti ti-user" />
            </button>
          </span>
        </div>
      </div>

      <div className="ticket-cab__linha ticket-cab__linha--meta">
        <span
          className="ticket-cab__pilula ticket-cab__pilula--etapa"
          style={{ ['--cor' as string]: ticket.stage_color }}
        >
          <span className="ticket-cab__ponto" />
          {ticket.stage_name}
        </span>
        <span
          className="ticket-cab__pilula ticket-cab__pilula--prioridade"
          style={{ ['--cor' as string]: COR_PRIORIDADE[ticket.priority] }}
          title="Prioridade"
        >
          <span className="ticket-cab__barra" />
          {ROTULO_PRIORIDADE[ticket.priority]}
        </span>
        {ticket.team && (
          <span className="ticket-cab__meta">
            <i className="ti ti-users-group" />
            {ticket.team.name}
          </span>
        )}
        {/* Abaixo de 900px o painel de propriedades vira gaveta (detalhe.scss) e
            era o único lugar com o nome do responsável — em tela estreita dava
            para assumir sem saber que havia dono. Aqui não sai nunca. */}
        <span className="ticket-cab__meta">
          <i className="ti ti-headset" aria-hidden="true" />
          {nomeDoResponsavel ? (
            <>
              Responsável <strong>{nomeDoResponsavel}</strong>
            </>
          ) : (
            'Sem responsável'
          )}
        </span>
        <span className="ticket-cab__meta">
          <i className={ICONE_CANAL[ticket.source] ?? 'ti ti-mail'} />
          {ROTULO_CANAL[ticket.source] ?? ticket.source}
        </span>
        <span className="ticket-cab__meta ticket-cab__meta--quieto">
          Aberto em <time dateTime={ticket.created_at}>{formatarDataHora(ticket.created_at)}</time>{' '}
          por <strong>{ticket.requester_display}</strong>
          {ticket.company_name ? ` · ${ticket.company_name}` : ''}
        </span>

        <span className="ticket-cab__slas" aria-label="Prazos de SLA">
          <RelogioSlaChip rotulo="1ª resposta" relogio={ticket.sla.first_response} />
          <RelogioSlaChip rotulo="Resolução" relogio={ticket.sla.resolution} />
        </span>
      </div>

      {avisoExport && (
        <p className="ticket-cab__aviso" role="alert">
          <i className="ti ti-alert-circle" aria-hidden="true" />
          <span>{avisoExport}</span>
          <button type="button" onClick={() => setAvisoExport(null)} aria-label="Fechar aviso">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </p>
      )}

    </header>
  )
}
