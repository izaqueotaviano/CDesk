import { useEffect, useRef, useState } from 'react'
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
import { horaDe, iniciais, rotuloDoDia } from './format'

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
      <span className="cc-msg__avatar">{iniciais(msg.author_name)}</span>
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
}

/**
 * A conversa aberta — para quem ATENDE. Ler, todo interno pode (é o que
 * permite supervisão); escrever, só quem pegou: o compositor só aparece
 * quando o backend aceitaria a mensagem (`can_send`), e nos outros casos
 * a tela diz o que fazer em vez de deixar um botão que ia falhar.
 */
export function ConversaChat({ chatId, me }: Props) {
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

  const [texto, setTexto] = useState('')
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [fimDoHistorico, setFimDoHistorico] = useState(false)
  const inputAnexo = useRef<HTMLInputElement>(null)
  const fimMensagens = useRef<HTMLDivElement>(null)
  const ultimoSinalDigitando = useRef(0)

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

  return (
    <section className="cc-conversa">
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

      {(erroAcao || erroSocket) && <p className="cc-conversa__erro">{erroAcao ?? erroSocket}</p>}

      {podeEscrever && (
        <div className="cc-composer">
          <textarea
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
            <button type="button" className="cc-composer__enviar" disabled={!podeEnviarTexto} onClick={enviar}>
              Enviar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
