import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  pendentesDoErro,
  useAbrirChat,
  useChat,
  useConfigChat,
  useEncerrarChat,
  useEnviarArquivos,
  useMarcarLidas,
  useMensagensChat,
  useMeuChatVivo,
  usePendingRatings,
  type Chat,
  type MensagemChat,
} from '@/api/chat'
import { API_BASE_URL, ApiError } from '@/api/client'
import { useSalaChat } from '@/realtime/useSalaChat'
import { Botao } from '@/ui/Botao'
import { AvaliacaoChat } from './AvaliacaoChat'

function hora(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function quandoAbre(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return ` Volta ${d.toLocaleDateString('pt-BR')} às ${hora(iso)}.`
}

function Bolha({ msg }: { msg: MensagemChat }) {
  if (msg.is_system) {
    return (
      <p className="self-center text-pequeno italic text-tinta-terciaria">
        {msg.body} · {hora(msg.sent_at)}
      </p>
    )
  }
  const doAtendimento = msg.author_is_internal
  return (
    <div className={`flex max-w-[80%] flex-col gap-1 ${doAtendimento ? 'self-start' : 'self-end items-end'}`}>
      <span className="text-legenda text-tinta-terciaria">
        {msg.author_name} · {hora(msg.sent_at)}
        {msg.edited_at && ' · editada'}
      </span>
      {/* só anexo, sem texto: não desenha balão vazio em cima do arquivo */}
      {(msg.is_deleted || msg.body) && (
        <div
          className={`whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-corpo ${
            doAtendimento ? 'border-divisoria bg-superficie text-tinta' : 'border-acento/30 bg-acento-suave text-tinta'
          }`}
        >
          {msg.is_deleted ? <em className="text-tinta-terciaria">Mensagem apagada</em> : msg.body}
        </div>
      )}
      {msg.files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {msg.files.map((f) =>
            f.is_downloadable ? (
              <a
                key={f.id}
                href={`${API_BASE_URL}${f.url}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-divisoria bg-superficie px-2 py-1 text-pequeno text-acento"
              >
                📎 {f.filename}
              </a>
            ) : (
              <span key={f.id} className="rounded-md border border-divisoria px-2 py-1 text-pequeno text-tinta-terciaria">
                📎 {f.filename} · em verificação
              </span>
            ),
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A conversa do CLIENTE. Texto vai pelo socket (e trava sem conexão);
 * anexo vai por REST e funciona com o socket caído — é a regra, não um
 * detalhe: o arquivo nunca dependeu do socket.
 */
function ConversaPortal({ chatId }: { chatId: number }) {
  const { data: chat } = useChat(chatId)
  const { data: mensagens } = useMensagensChat(chatId)
  const { status, digitando, erro: erroSocket, enviarMensagem, enviarDigitando } = useSalaChat(chatId)
  const enviarArquivos = useEnviarArquivos(chatId)
  const encerrar = useEncerrarChat(chatId)
  const marcarLidas = useMarcarLidas(chatId)

  const [texto, setTexto] = useState('')
  const [confirmandoEncerrar, setConfirmandoEncerrar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const inputAnexo = useRef<HTMLInputElement>(null)
  const fim = useRef<HTMLDivElement>(null)
  const ultimoSinal = useRef(0)

  const total = mensagens?.length ?? 0
  const ultimoId = total > 0 ? mensagens![total - 1].id : null

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' })
  }, [ultimoId])

  const marcar = marcarLidas.mutate
  useEffect(() => {
    if (ultimoId == null || document.hidden) return
    marcar()
  }, [ultimoId, marcar])

  if (!chat) return <p className="text-corpo text-tinta-secundaria">Carregando…</p>

  const aberta = chat.status !== 'closed'
  const socketAberto = status === 'aberto'
  const podeEnviarTexto = aberta && socketAberto && texto.trim().length > 0

  function enviar() {
    if (!podeEnviarTexto) return
    enviarMensagem(texto.trim())
    enviarDigitando(false)
    setTexto('')
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-titulo font-forte text-tinta">Chat com o suporte</h1>
          <p className="text-pequeno text-tinta-secundaria">
            {chat.status === 'queued' && 'Aguardando um atendente — sua posição na fila está garantida.'}
            {chat.status === 'active' && `Você está falando com ${chat.agent_name ?? 'o atendimento'}.`}
            {chat.status === 'closed' && 'Conversa encerrada.'}
          </p>
        </div>
        <span className="text-legenda text-tinta-terciaria" title="Estado da conexão em tempo real">
          {status === 'aberto' ? '● conectado' : status === 'conectando' ? '● conectando…' : '● reconectando'}
        </span>
      </header>

      <div className="flex min-h-[320px] flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-divisoria bg-superficie-sutil p-4">
        {total === 0 ? (
          <p className="text-corpo text-tinta-terciaria">Nenhuma mensagem ainda.</p>
        ) : (
          mensagens!.map((m) => <Bolha key={m.id} msg={m} />)
        )}
        {digitando && (
          <p className="text-pequeno italic text-tinta-terciaria">{digitando.user_name} está digitando…</p>
        )}
        <div ref={fim} />
      </div>

      {chat.ticket_reference && (
        <p className="text-corpo text-tinta-secundaria">
          Esta conversa virou o chamado <strong>{chat.ticket_reference}</strong> — acompanhe em{' '}
          <Link to="/portal/tickets" className="text-acento underline">
            Meus chamados
          </Link>
          .
        </p>
      )}

      {(erro || erroSocket) && <p className="text-pequeno text-perigo">{erro ?? erroSocket}</p>}

      {aberta && (
        <div className="flex flex-col gap-2 rounded-lg border border-divisoria bg-superficie p-3">
          <textarea
            rows={2}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              const agora = Date.now()
              if (agora - ultimoSinal.current > 2000) {
                ultimoSinal.current = agora
                enviarDigitando(true)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                enviar()
              }
            }}
            placeholder={socketAberto ? 'Escreva sua mensagem…' : 'Sem conexão — o texto espera a conexão voltar; anexos continuam funcionando.'}
            className="rounded-md border border-borda-controle bg-superficie px-3 py-2 text-corpo text-tinta outline-none focus-visible:shadow-foco"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Botao
                variante="secundario"
                disabled={enviarArquivos.isPending}
                onClick={() => inputAnexo.current?.click()}
              >
                {enviarArquivos.isPending ? 'Enviando…' : '📎 Anexar'}
              </Botao>
              <input
                ref={inputAnexo}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const arquivos = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  if (arquivos.length === 0) return
                  setErro(null)
                  enviarArquivos.mutate(
                    { arquivos, texto: texto.trim() || undefined },
                    {
                      onSuccess: () => setTexto(''),
                      onError: (err) =>
                        setErro(err instanceof ApiError ? (err.detail ?? err.fieldErrors?.files?.[0] ?? 'Não foi possível anexar.') : 'Não foi possível anexar.'),
                    },
                  )
                }}
              />
              {confirmandoEncerrar ? (
                <>
                  <Botao
                    variante="perigo"
                    disabled={encerrar.isPending}
                    onClick={() =>
                      encerrar.mutate(undefined, {
                        onError: (err) => setErro(err instanceof ApiError ? (err.detail ?? 'Não foi possível encerrar.') : 'Não foi possível encerrar.'),
                      })
                    }
                  >
                    {encerrar.isPending ? 'Encerrando…' : 'Confirmar encerramento'}
                  </Botao>
                  <Botao variante="fantasma" onClick={() => setConfirmandoEncerrar(false)}>
                    Voltar
                  </Botao>
                </>
              ) : (
                <Botao variante="fantasma" onClick={() => setConfirmandoEncerrar(true)}>
                  Encerrar conversa
                </Botao>
              )}
            </div>
            <Botao disabled={!podeEnviarTexto} onClick={enviar}>
              Enviar
            </Botao>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Página do chat no portal. A ordem das telas é a ordem das regras do
 * backend: avaliação pendente trava tudo (vem primeiro), depois a conversa
 * viva se houver, e só então o botão de abrir — que ainda pode ser
 * recusado (fora do expediente devolve `code`, avaliação pendente devolve
 * os chats a avaliar).
 */
export function PaginaPortalChat() {
  const vivo = useMeuChatVivo()
  const pendentes = usePendingRatings()
  const config = useConfigChat()
  const abrir = useAbrirChat()
  const [pendentesDoAbrir, setPendentesDoAbrir] = useState<Chat[]>([])
  const [erroAbrir, setErroAbrir] = useState<{ detail: string; code?: string } | null>(null)

  const pendente = pendentes.data?.[0] ?? pendentesDoAbrir[0] ?? null

  if (vivo.isLoading || pendentes.isLoading) {
    return <p className="text-corpo text-tinta-secundaria">Carregando…</p>
  }

  if (pendente) {
    return (
      <AvaliacaoChat
        chat={pendente}
        config={config.data}
        onAvaliado={() => setPendentesDoAbrir((lista) => lista.filter((c) => c.id !== pendente.id))}
      />
    )
  }

  if (vivo.data) return <ConversaPortal chatId={vivo.data.id} />

  const filaFechada = config.data?.queue_open === false

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-titulo-lg font-forte text-tinta">Chat com o suporte</h1>
      {filaFechada ? (
        <p className="text-corpo text-tinta-secundaria">
          Estamos fora do horário de atendimento por chat.{quandoAbre(config.data?.queue_opens_at ?? null)}{' '}
          <Link to="/portal/tickets/novo" className="text-acento underline">
            Abra um chamado
          </Link>{' '}
          e a equipe responde assim que o expediente começar.
        </p>
      ) : (
        <>
          <p className="text-corpo text-tinta-secundaria">
            Fale com um atendente agora. A conversa fica salva e, se ninguém puder atender, vira um chamado
            automaticamente.
          </p>
          <div>
            <Botao
              disabled={abrir.isPending}
              onClick={() => {
                setErroAbrir(null)
                abrir.mutate(undefined, {
                  onError: (e) => {
                    const p = pendentesDoErro(e)
                    if (p.length > 0) {
                      setPendentesDoAbrir(p)
                      return
                    }
                    setErroAbrir({
                      detail: e instanceof ApiError ? (e.detail ?? 'Não foi possível abrir o chat.') : 'Não foi possível abrir o chat.',
                      code: e instanceof ApiError ? e.code : undefined,
                    })
                  },
                })
              }}
            >
              {abrir.isPending ? 'Abrindo…' : 'Iniciar conversa'}
            </Botao>
          </div>
        </>
      )}
      {erroAbrir && (
        <p className="text-corpo text-perigo">
          {erroAbrir.detail}
          {erroAbrir.code === 'fora_do_expediente' && (
            <>
              {' '}
              <Link to="/portal/tickets/novo" className="underline">
                Abrir chamado
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  )
}
