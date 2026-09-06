import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { useLocation } from 'react-router-dom'
import type { Me } from '@/api/types'
import { useTabs } from '@/stores/tabs'
import { formatarDataHora } from '../format'
import { Compositor } from './Compositor'
import { useAcoesTicket } from './dados'
import {
  ICONE_CANAL,
  agruparPorDia,
  descreverEvento,
  iniciais,
  mensagemDeErro,
  mesclarLinhaDoTempo,
  tamanhoArquivo,
  tempoRelativo,
  urlApi,
} from './linhaDoTempo'
import type { Anexo, Evento, Mensagem, TicketDetalhe } from './tiposDetalhe'

const ROTULO_VARREDURA: Record<string, string> = {
  pending: 'verificando…',
  infected: 'bloqueado pelo antivírus',
  error: 'falha na verificação',
  skipped: 'não verificado',
}

/** O corpo guarda `@[user:12]`; o serializer manda `mentions` com o nome. */
function renderizarCorpo(msg: Mensagem): ReactNode {
  const partes = msg.body.split(/(@\[(?:user|team):\d+\])/g)
  if (partes.length === 1) return msg.body
  return partes.map((p, i) => {
    const m = p.match(/^@\[(user|team):(\d+)\]$/)
    if (!m) return p
    const alvo = msg.mentions.find((x) => x.id === Number(m[2]))
    return alvo ? (
      <span key={i} className="msg__mencao">
        @{alvo.display}
      </span>
    ) : (
      p
    )
  })
}

function AnexoChip({ anexo }: { anexo: Anexo }) {
  const tamanho = tamanhoArquivo(anexo.size_bytes)
  if (anexo.is_downloadable && anexo.url) {
    return (
      <a className="msg__anexo" href={urlApi(anexo.url)} target="_blank" rel="noreferrer">
        <i className="ti ti-paperclip" />
        <span className="msg__anexo-nome">{anexo.filename}</span>
        {tamanho && <span className="msg__anexo-tam">{tamanho}</span>}
        <i className="ti ti-download msg__anexo-baixar" aria-hidden="true" />
      </a>
    )
  }
  const motivo = ROTULO_VARREDURA[anexo.scan_status ?? ''] ?? 'indisponível'
  return (
    <span className="msg__anexo msg__anexo--off" title={`Download indisponível: ${motivo}`}>
      <i className="ti ti-paperclip" />
      <span className="msg__anexo-nome">{anexo.filename}</span>
      <span className="msg__anexo-tam">{motivo}</span>
    </span>
  )
}

/** Editor inline de uma mensagem. Monta só enquanto edita — o estado nasce
 *  do corpo atual na montagem, sem efeito para sincronizar. */
function EditorMensagem({
  original,
  onSalvar,
  onCancelar,
}: {
  original: string
  onSalvar: (body: string) => Promise<unknown>
  onCancelar: () => void
}) {
  const [texto, setTexto] = useState(original)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!texto.trim() || texto === original) return onCancelar()
    setOcupado(true)
    setErro(null)
    try {
      await onSalvar(texto.trim())
    } catch (e) {
      setErro(
        `${mensagemDeErro(e, 'Não foi possível salvar a correção.')} O texto editado continua aqui.`,
      )
      setOcupado(false)
    }
  }

  return (
    <div className="msg__editor">
      <textarea
        autoFocus
        value={texto}
        rows={4}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancelar()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) salvar()
        }}
        aria-label="Corrigir mensagem"
      />
      <div className="msg__editor-acoes">
        <button
          type="button"
          className="msg__btn msg__btn--primario"
          onClick={salvar}
          disabled={ocupado}
        >
          {ocupado ? 'Salvando…' : 'Salvar correção'}
        </button>
        <button type="button" className="msg__btn" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </button>
        <span className="msg__editor-dica">O cliente vê que a mensagem foi editada.</span>
      </div>
      {erro && (
        <p className="msg__erro" role="alert">
          {erro}
        </p>
      )}
    </div>
  )
}

interface MensagemProps {
  msg: Mensagem
  agoraMs: number
  editando: boolean
  onEditar: () => void
  onCancelarEdicao: () => void
  onSalvar: (body: string) => Promise<unknown>
  onApagar: () => Promise<unknown>
}

function ItemMensagem({
  msg,
  agoraMs,
  editando,
  onEditar,
  onCancelarEdicao,
  onSalvar,
  onApagar,
}: MensagemProps) {
  const interna = !msg.is_public
  const sistema = msg.source === 'system'
  const [confirmandoApagar, setConfirmandoApagar] = useState(false)
  const [apagando, setApagando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function apagar() {
    setApagando(true)
    setErro(null)
    try {
      await onApagar()
      setConfirmandoApagar(false)
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível apagar a mensagem.'))
    } finally {
      setApagando(false)
    }
  }

  const papel = sistema ? 'Sistema' : msg.author_is_internal ? 'Equipe' : 'Cliente'
  const classe =
    'msg' +
    (msg.author_is_internal ? ' msg--agente' : ' msg--cliente') +
    (interna ? ' msg--interna' : '') +
    (sistema ? ' msg--sistema' : '') +
    (msg.is_deleted ? ' msg--apagada' : '')

  return (
    <article
      id={`mensagem-${msg.id}`}
      className={classe}
      aria-label={`${interna ? 'Nota interna' : 'Mensagem'} de ${msg.author_name}`}
    >
      <span
        className={'msg__avatar' + (msg.author_is_internal ? ' msg__avatar--agente' : '')}
        aria-hidden="true"
      >
        {sistema ? (
          <i className="ti ti-robot" />
        ) : msg.author_avatar ? (
          <img src={urlApi(msg.author_avatar)} alt="" />
        ) : (
          iniciais(msg.author_name)
        )}
      </span>

      <div className="msg__corpo">
        <header className="msg__meta">
          <span className="msg__autor">{msg.author_name}</span>
          <span className={`msg__papel msg__papel--${papel.toLowerCase()}`}>{papel}</span>
          <i className={ICONE_CANAL[msg.source] ?? 'ti ti-mail'} aria-hidden="true" />
          <time
            dateTime={msg.created_at}
            title={formatarDataHora(msg.created_at)}
            className="msg__tempo"
          >
            {tempoRelativo(msg.created_at, agoraMs)}
          </time>
          {interna && (
            <span className="msg__etiqueta msg__etiqueta--interna">
              <i className="ti ti-lock" /> Nota interna
            </span>
          )}
          {msg.is_first_response && <span className="msg__etiqueta">1ª resposta</span>}
          {msg.edited_at && (
            <span className="msg__editada" title={`Editada em ${formatarDataHora(msg.edited_at)}`}>
              editada
            </span>
          )}

          {msg.can_edit && !msg.is_deleted && !editando && !confirmandoApagar && (
            <span className="msg__acoes">
              <button type="button" onClick={onEditar} aria-label="Editar mensagem" title="Editar">
                <i className="ti ti-pencil" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmandoApagar(true)}
                aria-label="Apagar mensagem"
                title="Apagar"
              >
                <i className="ti ti-trash" />
              </button>
            </span>
          )}
        </header>

        {editando ? (
          <EditorMensagem original={msg.body} onSalvar={onSalvar} onCancelar={onCancelarEdicao} />
        ) : (
          <div className="msg__texto">
            {msg.is_deleted ? <em>Mensagem apagada</em> : renderizarCorpo(msg)}
          </div>
        )}

        {confirmandoApagar && (
          <div className="msg__confirmar" role="alertdialog" aria-label="Confirmar exclusão">
            <span>Apagar esta mensagem? Ela some para todo mundo.</span>
            <button
              type="button"
              className="msg__btn msg__btn--perigo"
              onClick={apagar}
              disabled={apagando}
            >
              {apagando ? 'Apagando…' : 'Apagar'}
            </button>
            <button
              type="button"
              className="msg__btn"
              onClick={() => setConfirmandoApagar(false)}
              disabled={apagando}
            >
              Cancelar
            </button>
          </div>
        )}

        {erro && (
          <p className="msg__erro" role="alert">
            {erro}
          </p>
        )}

        {msg.attachments.length > 0 && (
          <div className="msg__anexos">
            {msg.attachments.map((a) => (
              <AnexoChip key={a.id} anexo={a} />
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

function ItemEvento({ evento, agoraMs }: { evento: Evento; agoraMs: number }) {
  const { texto, tom } = descreverEvento(evento)
  return (
    <div className={`evento evento--${tom}`} role="status">
      <span className="evento__linha" aria-hidden="true" />
      <span className="evento__miolo">
        <span className="evento__ponto" aria-hidden="true" />
        <span className="evento__texto">{texto}</span>
        {evento.note && <span className="evento__nota">“{evento.note}”</span>}
        <time
          dateTime={evento.created_at}
          title={formatarDataHora(evento.created_at)}
          className="evento__tempo"
        >
          {tempoRelativo(evento.created_at, agoraMs)}
        </time>
      </span>
      <span className="evento__linha" aria-hidden="true" />
    </div>
  )
}

interface Props {
  ticket: TicketDetalhe
  me: Me | undefined
  agoraMs: number
  /** Incrementado pelo cabeçalho quando a pessoa pede para reabrir — o
   *  compositor foca em modo público com status "Aberto". */
  pedidoReabrir: number
}

/** "Perto do fim" o bastante para o push de uma mensagem nova ainda arrastar
 *  a leitura — acima disso, a pessoa está lendo o meio da thread de propósito
 *  e uma mensagem chegando não pode puxar a rolagem para longe de onde ela
 *  está (item 21). */
const LIMIAR_PERTO_DO_FIM_PX = 80

/** Debounce de gravação da posição de rolagem — "razoável", não a cada pixel
 *  (item 21): local e síncrono (`atualizarScroll`, stores/tabs.ts, nunca vai
 *  para o servidor), então não precisa dos 2s do sync com o backend
 *  (DEBOUNCE_MS em tabs.ts) — só o bastante para não gravar a cada frame de
 *  scroll contínuo. */
const DEBOUNCE_SCROLL_MS = 400

export function Conversa({ ticket, me, agoraMs, pedidoReabrir }: Props) {
  const { editarMensagem, apagarMensagem } = useAcoesTicket(ticket.id)
  const [mostrarEventos, setMostrarEventos] = useState(true)
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  // scroll é local por contrato (docs/06 — nunca sincroniza com o servidor),
  // então o valor lido aqui é só o desta aba neste navegador; correto para
  // "restaura ao trocar de aba/voltar" (item 21).
  const scrollSalvo = useTabs(
    (s) => s.tabs.find((a) => a.ticketId === ticket.id)?.scroll ?? 0,
  )
  const atualizarScroll = useTabs((s) => s.atualizarScroll)
  const debounceScrollRef = useRef<ReturnType<typeof setTimeout>>()
  // Perto do fim decide se uma mensagem NOVA arrasta a rolagem (mesma ideia
  // de app de chat); começa true porque a primeira coisa que a pessoa vê é o
  // fim da conversa (ou a mensagem ancorada — ver o efeito de montagem).
  const pertoDoFimRef = useRef(true)

  const grupos = useMemo(
    () =>
      agruparPorDia(mesclarLinhaDoTempo(ticket.messages, ticket.events, mostrarEventos), agoraMs),
    [ticket.messages, ticket.events, mostrarEventos, agoraMs],
  )

  // Só na MONTAGEM (o componente remonta por ticket — PaginaDetalheTicket usa
  // `key={ticket.id}` — então isto roda de novo a cada troca de aba/ticket):
  // três prioridades, da mais para a menos específica —
  //   1) link de notificação de menção com #mensagem-{pk} (item 22, único
  //      anchor que o backend gera: apps/tickets/services/mentions.py:116);
  //   2) posição salva desta aba (item 21: "restaura ao trocar de aba/voltar");
  //   3) fim da conversa (comportamento anterior, mantido para thread nova).
  useEffect(() => {
    const alvoDaAncora = location.hash.match(/^#mensagem-(\d+)$/)
    if (alvoDaAncora) {
      document.getElementById(`mensagem-${alvoDaAncora[1]}`)?.scrollIntoView({ block: 'center' })
      return
    }
    if (scrollSalvo > 0 && listaRef.current) {
      listaRef.current.scrollTop = scrollSalvo
      return
    }
    fimRef.current?.scrollIntoView({ block: 'end' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Rola para a mensagem nova SÓ quando a pessoa já estava perto do fim —
  // chegar por realtime (ws) não pode arrastar quem está lendo o meio da
  // thread (item 21; antes disparava sempre, só com `totalMensagens` na
  // dependência).
  const totalMensagens = ticket.messages.length
  const primeiraRenderRef = useRef(true)
  useEffect(() => {
    if (primeiraRenderRef.current) {
      // a primeira "chegada" de mensagens é a montagem — já tratada acima
      // (âncora/posição salva/fim); disparar de novo aqui sobrescreveria.
      primeiraRenderRef.current = false
      return
    }
    if (pertoDoFimRef.current) {
      fimRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [totalMensagens])

  useEffect(() => () => clearTimeout(debounceScrollRef.current), [])

  function aoRolar(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const distanciaDoFim = el.scrollHeight - el.scrollTop - el.clientHeight
    pertoDoFimRef.current = distanciaDoFim < LIMIAR_PERTO_DO_FIM_PX

    clearTimeout(debounceScrollRef.current)
    const scrollTop = el.scrollTop
    debounceScrollRef.current = setTimeout(() => {
      atualizarScroll(ticket.id, scrollTop)
    }, DEBOUNCE_SCROLL_MS)
  }

  const publicas = ticket.messages.filter((m) => m.is_public && !m.is_deleted).length
  const notas = ticket.messages.filter((m) => !m.is_public && !m.is_deleted).length
  const semMensagens = ticket.messages.length === 0

  return (
    <section className="conversa" aria-label="Conversa">
      <header className="conversa__topo">
        <h2 className="conversa__titulo">Conversa</h2>
        <span className="conversa__contagem">
          {publicas} {publicas === 1 ? 'mensagem' : 'mensagens'}
          {notas > 0 && ` · ${notas} ${notas === 1 ? 'nota interna' : 'notas internas'}`}
        </span>
        {ticket.events.length > 0 && (
          <label className="conversa__interruptor">
            <input
              type="checkbox"
              checked={mostrarEventos}
              onChange={(e) => setMostrarEventos(e.target.checked)}
            />
            <span>Mostrar eventos</span>
          </label>
        )}
      </header>

      {/* role="log" + aria-live="polite" + aria-relevant="additions": é o
          papel exato do WAI-ARIA para "coisas chegando" (item 31) — sem ele,
          a resposta do cliente que chega por realtime nunca é anunciada para
          quem usa leitor de tela (o único aviso análogo antes disto era o
          role="status" dos eventos de status, poucas linhas abaixo). */}
      <div
        ref={listaRef}
        className="conversa__lista"
        tabIndex={0}
        aria-label="Mensagens"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={aoRolar}
      >
        {grupos.map((g) => (
          <section key={g.chave} className="conversa__dia" aria-label={g.rotulo}>
            <div className="conversa__dia-rotulo">
              <span>{g.rotulo}</span>
            </div>
            {g.itens.map((item) =>
              item.tipo === 'mensagem' ? (
                <ItemMensagem
                  key={`m${item.mensagem.id}`}
                  msg={item.mensagem}
                  agoraMs={agoraMs}
                  editando={editandoId === item.mensagem.id}
                  onEditar={() => setEditandoId(item.mensagem.id)}
                  onCancelarEdicao={() => setEditandoId(null)}
                  onSalvar={async (body) => {
                    await editarMensagem.mutateAsync({ mensagemId: item.mensagem.id, body })
                    setEditandoId(null)
                  }}
                  onApagar={() => apagarMensagem.mutateAsync(item.mensagem.id)}
                />
              ) : (
                <ItemEvento key={`e${item.evento.id}`} evento={item.evento} agoraMs={agoraMs} />
              ),
            )}
          </section>
        ))}

        {semMensagens && (
          <div className="conversa__vazio">
            <i className="ti ti-message-2" aria-hidden="true" />
            <p className="conversa__vazio-titulo">Nenhuma mensagem ainda</p>
            <p>
              Responda ao cliente abaixo — a primeira resposta pública fecha o relógio de 1ª
              resposta — ou registre uma nota interna para a equipe.
            </p>
          </div>
        )}
        <div ref={fimRef} />
      </div>

      <Compositor ticket={ticket} me={me} pedidoReabrir={pedidoReabrir} />
    </section>
  )
}
