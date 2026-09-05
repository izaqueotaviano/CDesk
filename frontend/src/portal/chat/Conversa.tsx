import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Check, Paperclip, RotateCcw, Send, X } from 'lucide-react'
import {
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
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { Bolha, PilulaChat } from './componentes'

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
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="ml-auto h-16 w-1/2" />
      </div>
    )
  }

  const aberta = chat.status !== 'closed'
  const podeReabrir = aberta === false && !chat.rating_pending
  const socketAberto = status === 'aberto'
  const podeEnviarTexto = aberta && socketAberto && texto.trim().length > 0
  const grupos = agruparPorDia(mensagens ?? [], agora)

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

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-divisoria p-4">
        {onVoltar && (
          <Button variant="ghost" size="icon-sm" onClick={onVoltar} aria-label="Voltar para a lista" className="md:hidden">
            <ArrowLeft />
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
          <span className="inline-flex items-center gap-2 text-legenda text-tinta-secundaria">
            <PilulaChat chat={chat} />
            {aberta && (
              <span title="Estado da conexão em tempo real">
                {socketAberto ? '● conectado' : status === 'conectando' ? '● conectando…' : '● reconectando'}
              </span>
            )}
          </span>
        </div>
        {aberta &&
          (confirmandoEncerrar ? (
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmandoEncerrar(false)}>
                Voltar
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={encerrar.isPending}
                onClick={() =>
                  encerrar.mutate(undefined, {
                    onError: (e) =>
                      setErro(e instanceof ApiError ? (e.detail ?? 'Não foi possível encerrar.') : 'Não foi possível encerrar.'),
                  })
                }
              >
                {encerrar.isPending ? 'Encerrando…' : 'Confirmar'}
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => setConfirmandoEncerrar(true)}>
              Encerrar conversa
            </Button>
          ))}
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
            <RotateCcw /> {reabrir.isPending ? 'Reabrindo…' : 'Reabrir'}
          </Button>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {total === 0 ? (
          <p className="m-auto text-pequeno text-tinta-secundaria">Nenhuma mensagem ainda.</p>
        ) : (
          grupos.map((g) => (
            <section key={g.rotulo} className="flex flex-col gap-3" aria-label={g.rotulo}>
              <h3 className="flex items-center gap-3 text-legenda font-medio uppercase tracking-rotulo text-tinta-secundaria before:h-px before:flex-1 before:bg-divisoria after:h-px after:flex-1 after:bg-divisoria">
                {g.rotulo}
              </h3>
              {g.itens.map((m) =>
                editando?.id === m.id ? (
                  <div key={m.id} className="ml-auto flex w-full max-w-[85%] flex-col gap-2">
                    <textarea
                      value={editando.texto}
                      onChange={(e) => setEditando({ id: m.id, texto: e.target.value })}
                      rows={2}
                      aria-label="Editar mensagem"
                      autoFocus
                      className="w-full rounded-lg border border-acento bg-superficie px-3 py-2 text-corpo text-tinta shadow-elevacao-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/30"
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
                        <Check /> Salvar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Bolha key={m.id} msg={m} onEditar={(x) => setEditando({ id: x.id, texto: x.body })} onExcluir={setExcluindo} />
                ),
              )}
            </section>
          ))
        )}
        {digitando && (
          <p className="text-legenda italic text-tinta-secundaria">{primeiroNome(digitando.user_name)} está digitando…</p>
        )}
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
            className="w-full resize-none rounded-lg border border-divisoria bg-superficie px-3 py-2 text-corpo text-tinta shadow-elevacao-1 placeholder:text-tinta-terciaria focus-visible:border-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/30"
          />
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" disabled={enviarArquivos.isPending} onClick={() => inputAnexo.current?.click()}>
              <Paperclip /> {enviarArquivos.isPending ? 'Enviando…' : 'Anexar'}
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
            <Button onClick={enviar} disabled={!podeEnviarTexto} title="Enter envia, Shift+Enter quebra linha">
              <Send /> Enviar
            </Button>
          </div>
        </div>
      )}

      <Dialog open={excluindo != null} onOpenChange={(a) => !a && setExcluindo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir esta mensagem?</DialogTitle>
            <DialogDescription>Ela some da conversa para você e para o suporte. Não dá para desfazer.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExcluindo(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={excluir.isPending}
              onClick={() =>
                excluindo &&
                excluir.mutate(excluindo.id, {
                  onSuccess: () => setExcluindo(null),
                  onError: (e) => toast.error(e instanceof ApiError ? (e.detail ?? 'Não foi possível excluir.') : 'Não foi possível excluir.'),
                })
              }
            >
              <X /> Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
