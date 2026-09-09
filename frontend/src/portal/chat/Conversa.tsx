import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { IconArrowLeft, IconCheck, IconPaperclip, IconPencil, IconRotateClockwise, IconSend, IconTrash } from '@tabler/icons-react'
import {
  LIMITE_MENSAGENS,
  useCarregarAnteriores,
  useChat,
  useEditarMensagemChat,
  useEncerrarChat,
  useEnviarArquivos,
  useExcluirMensagemChat,
  useMarcarLidas,
  useMensagensChat,
  useReabrirChat,
  type MensagemChat,
} from '@/api/chat'
import { ApiError } from '@/api/client'
import { rotuloDia } from '@/resolv/tickets/detalhe/linhaDoTempo'
import { useSalaChat } from '@/realtime/useSalaChat'
import { useAgora } from '../lib/formato'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { Mensagem, MensagemDoSistema, PilulaChat } from './componentes'

function agruparPorDia(msgs: MensagemChat[], agoraMs: number): { rotulo: string; itens: MensagemChat[] }[] {
  const grupos: { rotulo: string; itens: MensagemChat[] }[] = []
  for (const m of msgs) {
    const rotulo = rotuloDia(m.sent_at, agoraMs)
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.rotulo === rotulo) ultimo.itens.push(m)
    else grupos.push({ rotulo, itens: [m] })
  }
  return grupos
}

/** Nome de quem está digitando — só o primeiro nome, como o resto da UI. */
function primeiroNome(nome: string) {
  return nome.trim().split(/\s+/)[0] ?? nome
}

const CAMPO =
  'w-full rounded-md border border-borda-campo bg-superficie px-3 py-2 text-[13px] text-tinta placeholder:text-tinta-terciaria hover:border-tinta-secundaria focus-visible:border-acento'

/**
 * A conversa: thread + composer. Texto vai pelo socket (trava sem conexão);
 * anexo sempre por REST — funciona mesmo com o socket caído, de propósito.
 * `onVoltar` só aparece no celular (a lista ocupa a largura toda lá).
 */
export function Conversa({ chatId, onVoltar }: { chatId: number; onVoltar?: () => void }) {
  const idBase = useId()
  const agora = useAgora()
  const { data: chat } = useChat(chatId)
  const { data: mensagens, isLoading } = useMensagensChat(chatId)
  const { status, digitando, erro: erroSocket, enviarMensagem, enviarDigitando } = useSalaChat(chatId)
  const enviarArquivos = useEnviarArquivos(chatId)
  const carregarAnteriores = useCarregarAnteriores(chatId)
  const encerrar = useEncerrarChat(chatId)
  const reabrir = useReabrirChat(chatId)
  const marcarLidas = useMarcarLidas(chatId)
  const editar = useEditarMensagemChat(chatId)
  const excluir = useExcluirMensagemChat(chatId)

  const [texto, setTexto] = useState('')
  const [confirmandoEncerrar, setConfirmandoEncerrar] = useState(false)
  const [editando, setEditando] = useState<{ id: number; texto: string } | null>(null)
  const [excluindo, setExcluindo] = useState<MensagemChat | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // A lista chega com as últimas LIMITE_MENSAGENS. Numa sessão mais longa as
  // anteriores existem no servidor mas não na tela — o botão busca de trás
  // pra frente até voltar vazio (o mesmo mecanismo do console).
  const [fimDoHistorico, setFimDoHistorico] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const inputAnexo = useRef<HTMLInputElement>(null)
  const fimRef = useRef<HTMLDivElement>(null)
  const ultimoSinalRef = useRef(0)

  const total = mensagens?.length ?? 0
  const ultimoId = total > 0 ? mensagens![total - 1].id : null

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' })
  }, [ultimoId])

  const marcar = marcarLidas.mutate
  useEffect(() => {
    if (ultimoId == null || document.hidden) return
    marcar()
  }, [ultimoId, marcar])

  if (!chat || isLoading) {
    return (
      <div className="flex h-full flex-col gap-3 p-4" aria-busy="true" aria-label="Carregando conversa">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  const aberta = chat.status !== 'closed'
  const podeReabrir = aberta === false && !chat.rating_pending
  const socketAberto = status === 'aberto'
  const podeEnviarTexto = aberta && socketAberto && texto.trim().length > 0
  const grupos = agruparPorDia(mensagens ?? [], agora)
  const conexao = socketAberto
    ? { tom: 'ok' as const, texto: 'Conectado' }
    : status === 'conectando'
      ? { tom: 'alerta' as const, texto: 'Conectando…' }
      : status === 'recusado'
        ? { tom: 'perigo' as const, texto: 'Sessão expirada — recarregue a página' }
        : { tom: 'alerta' as const, texto: 'Reconectando…' }

  function enviar() {
    if (!podeEnviarTexto) return
    enviarMensagem(texto.trim())
    enviarDigitando(false)
    setTexto('')
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  async function encerrarConversa() {
    try {
      await encerrar.mutateAsync(undefined)
    } catch (e) {
      setErro(e instanceof ApiError ? (e.detail ?? 'Não foi possível encerrar.') : 'Não foi possível encerrar.')
      throw e
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-divisoria p-4">
        {onVoltar && (
          <Button variant="ghost" size="icon-sm" onClick={onVoltar} aria-label="Voltar para a lista" className="md:hidden">
            <IconArrowLeft />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-corpo font-medio text-tinta">
            {chat.status === 'queued'
              ? 'Aguardando um atendente'
              : chat.agent_name
                ? `Você está falando com ${chat.agent_name}`
                : 'Suporte'}
          </p>
          <span className="mt-1 inline-flex flex-wrap items-center gap-2">
            <PilulaChat chat={chat} />
            {aberta && (
              <Badge variant={conexao.tom} ponto title="Estado da conexão em tempo real">
                {conexao.texto}
              </Badge>
            )}
          </span>
        </div>
        {aberta && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setConfirmandoEncerrar(true)}>
            Encerrar conversa
          </Button>
        )}
        {podeReabrir && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={reabrir.isPending}
            onClick={() =>
              reabrir.mutate(undefined, {
                onError: (e) => setErro(e instanceof ApiError ? (e.detail ?? 'Não foi possível reabrir.') : 'Não foi possível reabrir.'),
              })
            }
          >
            <IconRotateClockwise /> {reabrir.isPending ? 'Reabrindo…' : 'Reabrir'}
          </Button>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {total >= LIMITE_MENSAGENS && !fimDoHistorico && (
          <Button
            variant="ghost"
            size="sm"
            className="mx-auto"
            disabled={carregarAnteriores.isPending}
            onClick={() =>
              carregarAnteriores.mutate(undefined, {
                onSuccess: (quantas) => {
                  if (quantas === 0) setFimDoHistorico(true)
                },
                onError: () => toast.error('Não foi possível carregar as mensagens anteriores.'),
              })
            }
          >
            {carregarAnteriores.isPending ? 'Carregando…' : 'Carregar mensagens anteriores'}
          </Button>
        )}
        {total === 0 ? (
          <p className="m-auto text-pequeno text-tinta-secundaria">Nenhuma mensagem ainda.</p>
        ) : (
          grupos.map((g) => (
            <section key={g.rotulo} className="flex flex-col gap-2" aria-label={g.rotulo}>
              <h3 className="flex items-center gap-3 text-legenda font-medio uppercase tracking-rotulo text-tinta-secundaria before:h-px before:flex-1 before:bg-divisoria after:h-px after:flex-1 after:bg-divisoria">
                {g.rotulo}
              </h3>
              {g.itens.map((m) =>
                m.is_system ? (
                  <MensagemDoSistema key={m.id} msg={m} />
                ) : editando?.id === m.id ? (
                  <div key={m.id} className="flex flex-col gap-2 rounded-md border border-acento bg-superficie p-3">
                    <textarea
                      value={editando.texto}
                      onChange={(e) => setEditando({ id: m.id, texto: e.target.value })}
                      rows={2}
                      aria-label="Editar mensagem"
                      autoFocus
                      className={CAMPO}
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditando(null)}>
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        disabled={!editando.texto.trim() || editar.isPending}
                        onClick={() =>
                          editar.mutate(
                            { id: m.id, body: editando.texto.trim() },
                            {
                              onSuccess: () => setEditando(null),
                              onError: (e) =>
                                toast.error(e instanceof ApiError ? (e.detail ?? 'Não foi possível editar.') : 'Não foi possível editar.'),
                            },
                          )
                        }
                      >
                        <IconCheck /> Salvar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Mensagem
                    key={m.id}
                    msg={m}
                    acoes={
                      m.can_edit && !m.is_deleted ? (
                        <>
                          {/* alvo de 24px (WCAG 2.5.8) mesmo com o rótulo pequeno */}
                          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-legenda" onClick={() => setEditando({ id: m.id, texto: m.body })}>
                            <IconPencil className="!size-3" /> Editar
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-legenda hover:text-perigo" onClick={() => setExcluindo(m)}>
                            <IconTrash className="!size-3" /> Excluir
                          </Button>
                        </>
                      ) : undefined
                    }
                  />
                ),
              )}
            </section>
          ))
        )}
        {/* `polite` + o conteúdo trocando só quando MUDA quem digita: o leitor
            de tela anuncia uma vez, não a cada tecla. */}
        <p role="status" aria-live="polite" className="min-h-4 text-legenda italic text-tinta-secundaria">
          {digitando ? `${primeiroNome(digitando.user_name)} está digitando…` : ''}
        </p>
        <div ref={fimRef} />
      </div>

      {chat.ticket_reference && (
        <p className="border-t border-divisoria px-4 py-2 text-pequeno text-tinta-secundaria">
          Esta conversa virou o chamado <strong className="text-tinta">{chat.ticket_reference}</strong>.
        </p>
      )}

      {(erro || erroSocket) && (
        <p role="alert" className="border-t border-divisoria px-4 py-2 text-pequeno text-perigo">
          {erro ?? erroSocket}
        </p>
      )}

      {aberta && (
        <div className="flex flex-col gap-2 border-t border-divisoria p-3">
          <textarea
            id={`${idBase}-texto`}
            ref={areaRef}
            rows={2}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              const agoraTs = Date.now()
              if (agoraTs - ultimoSinalRef.current > 2000) {
                ultimoSinalRef.current = agoraTs
                enviarDigitando(true)
              }
            }}
            onKeyDown={aoTeclar}
            placeholder={socketAberto ? 'Escreva sua mensagem…' : 'Sem conexão — o texto espera voltar; anexos continuam funcionando.'}
            aria-label="Escreva sua mensagem"
            className={`${CAMPO} resize-none`}
          />
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" disabled={enviarArquivos.isPending} onClick={() => inputAnexo.current?.click()}>
              <IconPaperclip /> {enviarArquivos.isPending ? 'Enviando…' : 'Anexar'}
            </Button>
            <input
              ref={inputAnexo}
              type="file"
              multiple
              hidden
              aria-label="Escolher arquivos"
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
            {/* Botão invertido, como o `.cc-composer__enviar` do console: o azul de
                ação fica pro primário da tela, não pro "enviar" repetido a cada linha. */}
            <Button variant="inverse" onClick={enviar} disabled={!podeEnviarTexto} title="Enter envia, Shift+Enter quebra linha">
              <IconSend /> Enviar
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        aberto={confirmandoEncerrar}
        onFechar={() => setConfirmandoEncerrar(false)}
        onConfirmar={encerrarConversa}
        titulo="Encerrar esta conversa?"
        descricao="Depois de encerrar, você vai avaliar o atendimento antes de poder abrir um novo chat — é rápido, mas não dá para pular."
        rotuloConfirmar="Encerrar"
        perigo
      />

      <ConfirmDialog
        aberto={excluindo != null}
        onFechar={() => setExcluindo(null)}
        onConfirmar={async () => {
          if (!excluindo) return
          try {
            await excluir.mutateAsync(excluindo.id)
          } catch (e) {
            toast.error(e instanceof ApiError ? (e.detail ?? 'Não foi possível excluir.') : 'Não foi possível excluir.')
            throw e
          }
        }}
        titulo="Excluir esta mensagem?"
        descricao="Ela some da conversa para você e para o suporte. Não dá para desfazer."
        rotuloConfirmar="Excluir"
        perigo
      />
    </div>
  )
}
