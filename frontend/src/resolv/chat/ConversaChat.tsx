import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LIMITE_MENSAGENS,
  useCarregarAnteriores,
  useChat,
  useEnviarArquivos,
  useMarcarLidas,
  useMensagensChat,
  usePegarChat,
  useReabrirChat,
  type ArquivoChat,
  type MensagemChat,
} from '@/api/chat'
import { API_BASE_URL, ApiError } from '@/api/client'
import type { Me } from '@/api/types'
import { useSalaChat } from '@/realtime/useSalaChat'
import { fileSize } from '@/cvz/components/ChatWidget/ChatWidget'
import { identidadeDe } from '@/ui/identidade'
import { useAplicarMacroChat, useMacros, type Macro } from './dados'
import { horaDe, iniciais, rotuloDoDia } from './format'

/** "Envio de nota" acha "Envio de Nota"; "ACME" acha "acme" — mesma função,
 *  copiada (não importada) de resolv/tickets/detalhe/Compositor.tsx: a casa
 *  já aceita essa duplicação em vez de um utilitário compartilhado entre
 *  features para seis linhas (mesmo precedente ali documentado). */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Mesma interpolação de resolv/tickets/detalhe/linhaDoTempo.ts
 *  (`interpolarMacro`), copiada por ser de outra feature. O chat não tem
 *  `{{referencia}}` (não virou chamado ainda) — usada numa macro, a marca
 *  fica como está e entra em `marcadoresPendentes`, pedindo revisão. */
function interpolarMacro(texto: string, ctx: { solicitante?: string; empresa?: string }): string {
  return texto.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (original, chave: string) => {
    if (chave === 'solicitante' && ctx.solicitante) return ctx.solicitante.trim().split(/\s+/)[0] ?? ''
    if (chave === 'empresa' && ctx.empresa) return ctx.empresa
    return original
  })
}

function marcadoresPendentes(texto: string): string[] {
  return [...new Set(texto.match(/\{\{\s*[a-zA-Z_]+\s*\}\}/g) ?? [])]
}

/** Rótulo em pt-br da prioridade que a prévia da macro mostra — mesma escala
 *  de `Prioridade` (resolv/tickets/tipos.ts), copiada por ser tipo de outra
 *  feature. Prioridade não bate o mapa (ou é ''), a prévia cai no valor cru
 *  em vez de sumir com a informação. */
const ROTULO_PRIORIDADE_MACRO: Record<string, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}

const ROTULO_STATUS_SOCKET = {
  conectando: 'Conectando…',
  aberto: 'Conectado',
  fechado: 'Sem conexão — reconectando',
} as const

/** Quanto tempo entre dois sinais de "digitando" mandados pra sala. */
const INTERVALO_DIGITANDO_MS = 2_000

function Anexo({ arquivo }: { arquivo: ArquivoChat }) {
  if (!arquivo.is_downloadable) {
    return (
      <span className="cc-anexo cc-anexo--bloqueado" title={arquivo.scan_status}>
        <i className="ti ti-shield" />
        {arquivo.filename} · {arquivo.scan_status === 'pending' ? 'em verificação' : 'bloqueado'}
      </span>
    )
  }
  return (
    <a className="cc-anexo" href={`${API_BASE_URL}${arquivo.url}`} target="_blank" rel="noreferrer">
      <i className="ti ti-paperclip" />
      {arquivo.filename} · {fileSize(arquivo.size_bytes)}
    </a>
  )
}

type ItemDaLista = { tipo: 'dia'; rotulo: string; chave: string } | { tipo: 'msg'; msg: MensagemChat }

function Bolha({ msg }: { msg: MensagemChat }) {
  if (msg.is_system) {
    return (
      <div className="cc-msg cc-msg--sistema">
        <span>{msg.body}</span>
        <time>{horaDe(msg.sent_at)}</time>
      </div>
    )
  }
  return (
    <div className={'cc-msg' + (msg.author_is_internal ? ' cc-msg--agente' : '')}>
      <span className="cc-msg__avatar" {...identidadeDe(msg.author_name)}>{iniciais(msg.author_name)}</span>
      <div className="cc-msg__corpo">
        <div className="cc-msg__meta">
          <span className="cc-msg__autor">{msg.author_name}</span>
          <time>{horaDe(msg.sent_at)}</time>
          {msg.edited_at && <em>editada</em>}
        </div>
        {/* só anexo, sem texto: não desenha balão vazio em cima do arquivo */}
        {(msg.is_deleted || msg.body) && (
          <div className={'cc-msg__balao' + (msg.is_deleted ? ' cc-msg__balao--apagada' : '')}>
            {msg.is_deleted ? <em>Mensagem apagada</em> : msg.body}
          </div>
        )}
        {msg.files.length > 0 && (
          <div className="cc-msg__anexos">
            {msg.files.map((f) => (
              <Anexo key={f.id} arquivo={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface Props {
  chatId: number
  me: Me | undefined
  /** Dentro de um painel do mini chat: sem o cabeçalho grande (o painel já
   *  mostra quem é) e com espaçamento mais apertado. */
  compacto?: boolean
}

/**
 * A conversa aberta — para quem ATENDE. Ler, todo interno pode (é o que
 * permite supervisão); escrever, só quem pegou: o compositor só aparece
 * quando o backend aceitaria a mensagem (`can_send`), e nos outros casos
 * a tela diz o que fazer em vez de deixar um botão que ia falhar.
 */
export function ConversaChat({ chatId, me, compacto = false }: Props) {
  const idBase = useId()
  const navigate = useNavigate()
  const { data: chat, isLoading, isError } = useChat(chatId)
  const { data: mensagens, dataUpdatedAt } = useMensagensChat(chatId)
  // "agora" das faixas de dia = instante do último fetch, não Date.now()
  // em render (impuro) — o mesmo padrão da lista de tickets
  const agoraMs = dataUpdatedAt || 0
  const { status, digitando, erro: erroSocket, enviarMensagem, enviarDigitando } = useSalaChat(chatId)
  const enviarArquivos = useEnviarArquivos(chatId)
  const marcarLidas = useMarcarLidas(chatId)
  const carregarAnteriores = useCarregarAnteriores(chatId)
  const pegar = usePegarChat()
  const reabrir = useReabrirChat(chatId)
  const { data: macros } = useMacros()
  const aplicarMacro = useAplicarMacroChat(chatId)

  const [texto, setTexto] = useState('')
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [fimDoHistorico, setFimDoHistorico] = useState(false)
  const inputAnexo = useRef<HTMLInputElement>(null)
  const fimMensagens = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const ultimoSinalDigitando = useRef(0)
  // Filtro do menu de macro: texto digitado + índice virtualmente "ativo" (o
  // foco de verdade nunca sai do campo de filtro) — mesmo combobox com
  // `aria-activedescendant` de resolv/tickets/detalhe/Compositor.tsx.
  const [menuMacro, setMenuMacro] = useState(false)
  const [filtroMacro, setFiltroMacro] = useState('')
  const [macroAtiva, setMacroAtiva] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  const total = mensagens?.length ?? 0
  const ultimoId = total > 0 ? mensagens![total - 1].id : null

  // rola pro fim quando chega mensagem — inclusive a que vem pelo socket
  useEffect(() => {
    fimMensagens.current?.scrollIntoView({ block: 'end' })
  }, [ultimoId])

  // marca como lidas o que o outro lado mandou, enquanto a conversa está
  // aberta E a aba visível — lido por quem não estava olhando não é lido
  const marcar = marcarLidas.mutate
  useEffect(() => {
    if (ultimoId == null || document.hidden) return
    marcar()
  }, [ultimoId, chatId, marcar])

  // menu de macro fecha ao clicar fora / Esc — mesmo efeito do Compositor
  useEffect(() => {
    if (!menuMacro) return
    const fora = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuMacro(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuMacro(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [menuMacro])

  // aviso (macro aplicada) some sozinho
  useEffect(() => {
    if (!aviso) return
    const h = setTimeout(() => setAviso(null), 5000)
    return () => clearTimeout(h)
  }, [aviso])

  // texto digitado, erro e "fim do histórico" são POR conversa — quem troca
  // de chat remonta este componente (`key={chatId}` em PaginaChat), então
  // o estado nasce zerado sem precisar de efeito de reset

  if (isLoading) {
    return (
      <section className="cc-conversa cc-conversa--estado">
        <i className="ti ti-loader-2 cc-spin" />
      </section>
    )
  }
  if (isError || !chat) {
    return (
      <section className="cc-conversa cc-conversa--estado">
        <i className="ti ti-alert-triangle" />
        <p>Não foi possível abrir esta conversa.</p>
      </section>
    )
  }

  const souOAgente = me != null && chat.agent_id === me.id
  const podeEscrever = chat.status === 'active' && souOAgente
  const socketAberto = status === 'aberto'
  const podeEnviarTexto = podeEscrever && socketAberto && texto.trim().length > 0
  // Mesma permissão do chamado (`macro.use`, apps/accounts/rbac.py) — o
  // backend de aplicar macro no chat não checa RBAC (só "é o agente do
  // atendimento", chat_service.apply_macro), então quem esconde o menu por
  // permissão é a tela, igual ao Compositor do chamado.
  const podeMacro = me?.is_internal === true && (me?.permissions ?? []).includes('macro.use')

  function enviar() {
    if (!podeEnviarTexto) return
    enviarMensagem(texto.trim())
    enviarDigitando(false)
    setTexto('')
  }

  function aoDigitar(valor: string) {
    setTexto(valor)
    const agora = Date.now()
    if (agora - ultimoSinalDigitando.current > INTERVALO_DIGITANDO_MS) {
      ultimoSinalDigitando.current = agora
      enviarDigitando(true)
    }
  }

  function anexar(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return
    setErroAcao(null)
    enviarArquivos.mutate(
      { arquivos: Array.from(arquivos), texto: texto.trim() || undefined },
      {
        onSuccess: () => setTexto(''),
        onError: (e) =>
          setErroAcao(
            e instanceof ApiError
              ? (e.detail ?? e.fieldErrors?.files?.[0] ?? 'Não foi possível enviar o anexo.')
              : 'Não foi possível enviar o anexo.',
          ),
      },
    )
  }

  function usarMacro(m: Macro) {
    // `usarMacro` só é chamada de dentro do JSX abaixo do `if (!chat) return`
    // acima — mas é uma função aninhada, e o TS não propaga a checagem de
    // null-safety do escopo externo para dentro do fechamento.
    if (!chat) return
    setMenuMacro(false)
    setFiltroMacro('')
    setMacroAtiva(0)
    const corpo = interpolarMacro(m.body ?? '', {
      solicitante: chat.client_name,
      empresa: chat.company_name,
    })
    if (corpo) setTexto((t) => (t.trim() ? `${t}\n${corpo}` : corpo))
    const pendentes = marcadoresPendentes(corpo)
    const temAtendimento = Boolean(
      m.chat_name || m.category || m.priority || m.assignee || (m.tags && m.tags.length > 0),
    )
    if (temAtendimento) {
      aplicarMacro.mutate(m.id, {
        onError: (e) =>
          setErroAcao(
            `${e instanceof ApiError ? (e.detail ?? 'A macro não pôde atualizar os campos do atendimento.') : 'A macro não pôde atualizar os campos do atendimento.'} O texto foi inserido mesmo assim.`,
          ),
      })
    }
    setAviso(
      pendentes.length
        ? `Macro “${m.name}” aplicada — revise ${pendentes.join(', ')} no texto.`
        : `Macro “${m.name}” aplicada${temAtendimento ? ' (texto e campos do atendimento)' : ''}.`,
    )
    areaRef.current?.focus()
  }

  // faixas de dia entre mensagens
  const lista: ItemDaLista[] = []
  let diaAnterior = ''
  for (const m of mensagens ?? []) {
    const dia = rotuloDoDia(m.sent_at, agoraMs)
    if (dia !== diaAnterior) {
      lista.push({ tipo: 'dia', rotulo: dia, chave: `dia-${m.id}` })
      diaAnterior = dia
    }
    lista.push({ tipo: 'msg', msg: m })
  }

  const idMacroLista = `${idBase}-macro-lista`
  const idOpcaoMacro = (m: Macro) => `${idMacroLista}-${m.id}`
  // Filtra por nome E corpo, sem acento — índice ativo CLAMPADO aqui (não
  // corrigido num efeito): igual ao Compositor do chamado.
  const macrosFiltradas = (macros ?? []).filter((m) =>
    normalizar(`${m.name} ${m.body ?? ''}`).includes(normalizar(filtroMacro)),
  )
  const macroAtivaValida = Math.min(macroAtiva, Math.max(macrosFiltradas.length - 1, 0))

  return (
    <section className={'cc-conversa' + (compacto ? ' cc-conversa--compacta' : '')}>
      {!compacto && (
      <header className="cc-conversa__header">
        <div>
          <h1 className="cc-conversa__titulo">
            {chat.client_name}
            {chat.name && <span className="cc-conversa__nome-interno"> · {chat.name}</span>}
          </h1>
          <p className="cc-conversa__sub">
            {chat.company_name}
            {chat.status === 'queued' && ' · na fila'}
            {chat.status === 'active' && chat.agent_name && ` · com ${chat.agent_name}`}
            {chat.status === 'closed' && ' · encerrada'}
          </p>
        </div>
        <span className={'cc-conversa__socket cc-conversa__socket--' + status} title={ROTULO_STATUS_SOCKET[status]}>
          <i className="ti ti-point" />
          {ROTULO_STATUS_SOCKET[status]}
        </span>
      </header>
      )}

      <div className="cc-conversa__mensagens">
        {total >= LIMITE_MENSAGENS && !fimDoHistorico && (
          <button
            type="button"
            className="cc-conversa__anteriores"
            disabled={carregarAnteriores.isPending}
            onClick={() =>
              carregarAnteriores.mutate(undefined, {
                onSuccess: (quantas) => quantas === 0 && setFimDoHistorico(true),
              })
            }
          >
            {carregarAnteriores.isPending ? 'Carregando…' : 'Carregar mensagens anteriores'}
          </button>
        )}
        {total === 0 ? (
          <p className="cc-conversa__vazio">Nenhuma mensagem ainda.</p>
        ) : (
          lista.map((item) =>
            item.tipo === 'dia' ? (
              <div key={item.chave} className="cc-conversa__dia">
                <span>{item.rotulo}</span>
              </div>
            ) : (
              <Bolha key={item.msg.id} msg={item.msg} />
            ),
          )
        )}
        {digitando && me && digitando.user_id !== me.id && (
          <p className="cc-conversa__digitando">{digitando.user_name} está digitando…</p>
        )}
        <div ref={fimMensagens} />
      </div>

      {chat.status === 'queued' && (
        <div className="cc-conversa__banner">
          <span>Este chat está na fila. Pegue para responder.</span>
          <button
            type="button"
            disabled={pegar.isPending}
            onClick={() =>
              pegar.mutate(chatId, {
                onError: (e) => setErroAcao(e instanceof ApiError ? (e.detail ?? 'Não foi possível pegar.') : 'Não foi possível pegar.'),
              })
            }
          >
            Pegar chat
          </button>
        </div>
      )}

      {chat.status === 'active' && !souOAgente && (
        <div className="cc-conversa__banner cc-conversa__banner--neutro">
          <span>
            Em atendimento por {chat.agent_name ?? 'outro agente'} — você está só acompanhando.
          </span>
        </div>
      )}

      {chat.status === 'closed' && (
        <div className="cc-conversa__banner cc-conversa__banner--neutro">
          <span>
            Conversa encerrada.
            {chat.ticket_reference && (
              <>
                {' '}
                Virou o chamado{' '}
                <button type="button" className="cc-link" onClick={() => navigate(`/chamados/${chat.ticket_id}`)}>
                  {chat.ticket_reference}
                </button>
                .
              </>
            )}
          </span>
          {!chat.ticket_id && (
            <button
              type="button"
              disabled={reabrir.isPending}
              onClick={() =>
                reabrir.mutate(undefined, {
                  onError: (e) => setErroAcao(e instanceof ApiError ? (e.detail ?? 'Não foi possível reabrir.') : 'Não foi possível reabrir.'),
                })
              }
            >
              Reabrir
            </button>
          )}
        </div>
      )}

      {aviso && (
        <p className="cc-conversa__aviso" role="status">
          <i className="ti ti-bolt" aria-hidden="true" /> {aviso}
        </p>
      )}
      {(erroAcao || erroSocket) && <p className="cc-conversa__erro">{erroAcao ?? erroSocket}</p>}

      {podeEscrever && (
        <div className="cc-composer">
          <textarea
            ref={areaRef}
            className="cc-composer__textarea"
            placeholder={socketAberto ? 'Escreva para o cliente… (Enter envia, Shift+Enter quebra linha)' : 'Sem conexão — o texto espera a conexão voltar; anexos continuam indo.'}
            value={texto}
            onChange={(e) => aoDigitar(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                enviar()
              }
            }}
          />
          <div className="cc-composer__rodape">
            <div className="cc-composer__ferramentas">
              <button
                type="button"
                className="cc-composer__anexar"
                aria-label="Anexar arquivo"
                title="Anexo vai por REST — funciona mesmo sem conexão de socket"
                disabled={enviarArquivos.isPending}
                onClick={() => inputAnexo.current?.click()}
              >
                <i className="ti ti-paperclip" />
                {enviarArquivos.isPending ? 'Enviando…' : 'Anexar'}
              </button>
              <input
                ref={inputAnexo}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  anexar(e.target.files)
                  e.target.value = ''
                }}
              />

              {podeMacro && (macros?.length ?? 0) > 0 && (
                <div className="cc-composer__macro" ref={menuRef}>
                  <button
                    type="button"
                    className={'cc-composer__anexar' + (menuMacro ? ' cc-composer__anexar--ativa' : '')}
                    aria-haspopup="listbox"
                    aria-expanded={menuMacro}
                    onClick={() => {
                      // Abrir sempre começa sem filtro — reabrir com o texto
                      // da última vez leria como "a macro que eu buscei antes
                      // sumiu" (mesmo raciocínio do Compositor do chamado).
                      if (!menuMacro) {
                        setFiltroMacro('')
                        setMacroAtiva(0)
                      }
                      setMenuMacro((v) => !v)
                    }}
                  >
                    <i className="ti ti-bolt" aria-hidden="true" /> Aplicar macro…
                  </button>
                  {menuMacro && (
                    <div className="cc-composer__macro-painel">
                      {/* Foco fica AQUI o tempo todo — as opções não são
                          tabuláveis, seleção virtual via aria-activedescendant,
                          não navegação por Tab entre itens de um menu. */}
                      <input
                        type="text"
                        autoFocus
                        className="cc-composer__macro-filtro"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls={idMacroLista}
                        aria-autocomplete="list"
                        aria-activedescendant={
                          macrosFiltradas[macroAtivaValida]
                            ? idOpcaoMacro(macrosFiltradas[macroAtivaValida])
                            : undefined
                        }
                        placeholder="Filtrar macros…"
                        aria-label="Filtrar macros por nome ou texto"
                        value={filtroMacro}
                        onChange={(e) => {
                          setFiltroMacro(e.target.value)
                          setMacroAtiva(0)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            setMacroAtiva((i) => Math.min(i + 1, macrosFiltradas.length - 1))
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault()
                            setMacroAtiva((i) => Math.max(i - 1, 0))
                          } else if (e.key === 'Enter') {
                            const m = macrosFiltradas[macroAtivaValida]
                            if (m) {
                              e.preventDefault()
                              usarMacro(m)
                            }
                          }
                          // Escape: sem handler próprio — o mousedown/keydown
                          // de documento (useEffect acima) já fecha o menu.
                        }}
                      />
                      <ul
                        id={idMacroLista}
                        className="cc-composer__macro-menu"
                        role="listbox"
                        aria-label="Macros"
                      >
                        {macrosFiltradas.length === 0 ? (
                          <li className="cc-composer__macro-vazio" role="presentation">
                            Nenhuma macro com “{filtroMacro}”.
                          </li>
                        ) : (
                          macrosFiltradas.map((m, i) => (
                            <li
                              key={m.id}
                              id={idOpcaoMacro(m)}
                              role="option"
                              aria-selected={i === macroAtivaValida}
                              className={
                                'cc-composer__macro-opcao' +
                                (i === macroAtivaValida ? ' cc-composer__macro-opcao--ativa' : '')
                              }
                              onMouseEnter={() => setMacroAtiva(i)}
                              onClick={() => usarMacro(m)}
                            >
                              <span className="cc-composer__macro-nome">{m.name}</span>
                              {m.body && (
                                <span className="cc-composer__macro-previa">
                                  {m.body.split('\n')[0]}
                                </span>
                              )}
                              {(m.category_name || m.priority || m.assignee_name) && (
                                <span className="cc-composer__macro-triagem">
                                  {[
                                    m.category_name && `categoria → ${m.category_name}`,
                                    m.priority &&
                                      `prioridade → ${ROTULO_PRIORIDADE_MACRO[m.priority] ?? m.priority}`,
                                    m.assignee_name && `responsável → ${m.assignee_name}`,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              )}
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button type="button" className="cc-composer__enviar" disabled={!podeEnviarTexto} onClick={enviar}>
              Enviar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
