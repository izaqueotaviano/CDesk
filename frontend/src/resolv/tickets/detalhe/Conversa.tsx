import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { useLocation } from 'react-router-dom'
import type { Me } from '@/api/types'
import { useTabs, type AbaTicket } from '@/stores/tabs'
import { identidadeDe } from '@/ui/identidade'
import { formatarDataHora } from '../format'
import { AgendarResposta } from './AgendarResposta'
import { useDigitacaoLocal } from './colaboracao/canalCompositor'
import { AvisoColisao } from './colaboracao/PresencaTicket'
import { AnexosDaMensagem } from './AnexosDaMensagem'
import { deMarcacao, paraMarcacao } from './mencoes'
import { Compositor } from './Compositor'
import { FotoOuIniciais } from './FotoOuIniciais'
import { useAcoesTicket } from './dados'
import {
  ICONE_CANAL,
  agruparPorDia,
  descreverEvento,
  mensagemDeErro,
  mesclarLinhaDoTempo,
  tempoRelativo,
} from './linhaDoTempo'
import type { Evento, Mensagem, TicketDetalhe } from './tiposDetalhe'
import { AssinaturaDaMensagem } from '@/ui/AssinaturaDaMensagem'
import { TextoFormatado } from '@/ui/TextoFormatado'

/** Editor inline de uma mensagem. Monta só enquanto edita — o estado nasce
 *  do corpo atual na montagem, sem efeito para sincronizar. */
function EditorMensagem({
  original,
  mencoes,
  onSalvar,
  onCancelar,
}: {
  original: string
  mencoes?: Mensagem['mentions']
  onSalvar: (body: string) => Promise<unknown>
  onCancelar: () => void
}) {
  // O campo mostra `@Nome`, não a marcação `@[user:12]` guardada no corpo;
  // ao salvar, `paraMarcacao` devolve cada nome à sua chave.
  const [legivel] = useState(() => deMarcacao(original, mencoes))
  const [texto, setTexto] = useState(legivel.texto)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!texto.trim() || texto === legivel.texto) return onCancelar()
    setOcupado(true)
    setErro(null)
    try {
      await onSalvar(paraMarcacao(texto.trim(), [], legivel.escolhidos))
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
        className="msg__avatar"
        aria-hidden="true"
        // Mensagem do sistema fica neutra (não é pessoa); as demais levam a
        // cor de quem escreveu — agente e cliente se distinguem por SEREM
        // pessoas diferentes, não por um tint fixo de "lado".
        {...(sistema ? {} : identidadeDe(msg.author_name))}
      >
        {sistema ? (
          <i className="ti ti-robot" />
        ) : (
          <FotoOuIniciais url={msg.author_avatar} nome={msg.author_name} />
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
          <EditorMensagem
            original={msg.body}
            mencoes={msg.mentions}
            onSalvar={onSalvar}
            onCancelar={onCancelarEdicao}
          />
        ) : (
          <div className="msg__texto">
            {/* formatação leve + menções (`@[user:12]` → chip com o nome de
                hoje, resolvido pelo servidor em `msg.mentions`) */}
            {msg.is_deleted ? (
              <em>Mensagem apagada</em>
            ) : (
              <TextoFormatado texto={msg.body} mencoes={msg.mentions} />
            )}
            {!msg.is_deleted && <AssinaturaDaMensagem html={msg.signature_html} />}
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

        {msg.attachments.length > 0 && <AnexosDaMensagem anexos={msg.attachments} />}
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

/** "Mostrar eventos" é preferência de DISPOSITIVO, não de conta — mesmo
 *  padrão de realtime/avisos.ts (localStorage direto com try/catch, sem
 *  store novo para uma chave só). Sem isto o componente reseta para "true" a
 *  cada `key={ticket.id}` (PaginaDetalheTicket remonta por ticket/aba), e
 *  quem prefere ler sem eventos desmarcava em CADA chamado. */
const CHAVE_MOSTRAR_EVENTOS = 'resolv-conversa-mostrar-eventos'

function preferenciaMostrarEventos(): boolean {
  try {
    return localStorage.getItem(CHAVE_MOSTRAR_EVENTOS) !== 'nao'
  } catch {
    return true // aba anônima/preview sem storage: cai no padrão (mostrar)
  }
}

function salvarPreferenciaMostrarEventos(valor: boolean) {
  try {
    localStorage.setItem(CHAVE_MOSTRAR_EVENTOS, valor ? 'sim' : 'nao')
  } catch {
    // melhor esforço: sem persistir, a escolha ainda vale nesta sessão
  }
}

/** Filtro de tipo de mensagem na thread (item de redução/apontamento):
 *  "todas" é o comportamento de sempre; "publicas"/"notas" restringem a
 *  linha do tempo ao subconjunto — pensado para o chamado de duas semanas
 *  onde quem assume no meio precisa achar rápido o que já foi combinado. */
type FiltroMensagens = 'todas' | 'publicas' | 'notas'

/** Debounce de gravação da posição de rolagem — "razoável", não a cada pixel
 *  (item 21): local e síncrono (`atualizarScroll`, stores/tabs.ts, nunca vai
 *  para o servidor), então não precisa dos 2s do sync com o backend
 *  (DEBOUNCE_MS em tabs.ts) — só o bastante para não gravar a cada frame de
 *  scroll contínuo. */
const DEBOUNCE_SCROLL_MS = 400

export function Conversa({ ticket, me, agoraMs, pedidoReabrir }: Props) {
  const { editarMensagem, apagarMensagem } = useAcoesTicket(ticket.id)
  const euRespondendo = useDigitacaoLocal((s) => s.porTicket[ticket.id] === 'resposta')
  const [mostrarEventos, setMostrarEventos] = useState(preferenciaMostrarEventos)
  const [filtro, setFiltro] = useState<FiltroMensagens>('todas')
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  // scroll é local por contrato (docs/06 — nunca sincroniza com o servidor),
  // então o valor lido aqui é só o desta aba neste navegador; correto para
  // "restaura ao trocar de aba/voltar" (item 21).
  const scrollSalvo = useTabs(
    (s) =>
      s.tabs.find((a): a is AbaTicket => a.tipo === 'ticket' && a.ticketId === ticket.id)?.scroll ?? 0,
  )
  const atualizarScroll = useTabs((s) => s.atualizarScroll)
  const debounceScrollRef = useRef<ReturnType<typeof setTimeout>>()
  // Perto do fim decide se uma mensagem NOVA arrasta a rolagem (mesma ideia
  // de app de chat); começa true porque a primeira coisa que a pessoa vê é o
  // fim da conversa (ou a mensagem ancorada — ver o efeito de montagem).
  const pertoDoFimRef = useRef(true)

  const publicas = ticket.messages.filter((m) => m.is_public && !m.is_deleted).length
  const notas = ticket.messages.filter((m) => !m.is_public && !m.is_deleted).length

  // Derivado, não estado corrigido em efeito: se o balde do filtro ativo
  // esvaziar no meio da sessão (a última nota foi apagada, por exemplo —
  // chega por refetch/realtime, não por gesto da pessoa), o botão daquele
  // filtro some junto (só aparece com notas > 0) — sem isto a pessoa ficaria
  // presa numa lista vazia sem como voltar para "Todas". `filtro` (o estado)
  // continua guardando a ÚLTIMA ESCOLHA da pessoa; só a leitura cai de volta
  // para "todas" enquanto o balde estiver vazio.
  const filtroEfetivo: FiltroMensagens = filtro === 'notas' && notas === 0 ? 'todas' : filtro

  // O filtro restringe as MENSAGENS antes de mesclar com os eventos — um
  // evento de status continua aparecendo mesmo em "só notas"/"só públicas",
  // porque ele não é nem uma coisa nem outra (mesclarLinhaDoTempo trata os
  // dois como trilhas independentes).
  const mensagensFiltradas = useMemo(() => {
    if (filtroEfetivo === 'publicas') return ticket.messages.filter((m) => m.is_public)
    if (filtroEfetivo === 'notas') return ticket.messages.filter((m) => !m.is_public)
    return ticket.messages
  }, [ticket.messages, filtroEfetivo])

  const grupos = useMemo(
    () =>
      agruparPorDia(
        mesclarLinhaDoTempo(mensagensFiltradas, ticket.events, mostrarEventos),
        agoraMs,
      ),
    [mensagensFiltradas, ticket.events, mostrarEventos, agoraMs],
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

  const semMensagens = ticket.messages.length === 0
  // Filtro ativo esvaziou a lista (ex.: "só notas" num chamado 100% público)
  // — distinto de `semMensagens` (chamado sem NENHUMA mensagem), que tem seu
  // próprio estado vazio mais abaixo com CTA para responder/anotar.
  const semResultadoNoFiltro = !semMensagens && filtroEfetivo !== 'todas' && grupos.length === 0

  return (
    <section className="conversa" aria-label="Conversa">
      <header className="conversa__topo">
        <h2 className="conversa__titulo">Conversa</h2>
        {notas > 0 ? (
          // Os mesmos números que antes eram só texto agora SÃO o filtro —
          // "menor movimento com maior efeito" num chamado de duas semanas
          // onde quem assume no meio rolava tudo pra achar o que já foi
          // combinado (auditoria desta rodada).
          <div className="conversa__filtros" role="group" aria-label="Filtrar mensagens por tipo">
            <button
              type="button"
              className={'conversa__filtro' + (filtro === 'todas' ? ' conversa__filtro--ativo' : '')}
              aria-pressed={filtro === 'todas'}
              onClick={() => setFiltro('todas')}
            >
              Todas
            </button>
            <button
              type="button"
              className={
                'conversa__filtro' + (filtro === 'publicas' ? ' conversa__filtro--ativo' : '')
              }
              aria-pressed={filtro === 'publicas'}
              onClick={() => setFiltro('publicas')}
            >
              {publicas} {publicas === 1 ? 'mensagem' : 'mensagens'}
            </button>
            <button
              type="button"
              className={'conversa__filtro' + (filtro === 'notas' ? ' conversa__filtro--ativo' : '')}
              aria-pressed={filtro === 'notas'}
              onClick={() => setFiltro('notas')}
            >
              {notas} {notas === 1 ? 'nota interna' : 'notas internas'}
            </button>
          </div>
        ) : (
          <span className="conversa__contagem">
            {publicas} {publicas === 1 ? 'mensagem' : 'mensagens'}
          </span>
        )}
        {ticket.events.length > 0 && (
          <label className="conversa__interruptor">
            <input
              type="checkbox"
              checked={mostrarEventos}
              onChange={(e) => {
                setMostrarEventos(e.target.checked)
                salvarPreferenciaMostrarEventos(e.target.checked)
              }}
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
              Responda ao cliente abaixo (a primeira resposta pública fecha o relógio de 1ª
              resposta) ou registre uma nota interna para a equipe.
            </p>
          </div>
        )}

        {semResultadoNoFiltro && (
          <p className="conversa__filtro-vazio" role="status">
            {filtroEfetivo === 'publicas'
              ? 'Nenhuma mensagem pública nesta conversa.'
              : 'Nenhuma nota interna nesta conversa.'}
          </p>
        )}
        <div ref={fimRef} />
      </div>

      <AgendarResposta ticket={ticket} me={me} />
      {/* colega escrevendo para o cliente agora: avisa ONDE a colisão acontece */}
      <AvisoColisao euDigitandoResposta={euRespondendo} />
      <Compositor ticket={ticket} me={me} pedidoReabrir={pedidoReabrir} />
    </section>
  )
}
