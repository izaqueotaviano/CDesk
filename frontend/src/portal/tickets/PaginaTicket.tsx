import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Hash,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { ApiError } from '@/api/client'
import { mensagemDeErro, rotuloDia, urlApi } from '@/resolv/tickets/detalhe/linhaDoTempo'
import type { Mensagem, TicketDetalhe } from '@/resolv/tickets/detalhe/tiposDetalhe'
import { Avatar } from '@/ui/Avatar'
import {
  LIMITE_ANEXO_MB,
  baixarPdfDoTicket,
  useAvaliacoesPendentesTicket,
  useAvaliarTicket,
  useEstimativaEquipe,
  useMensagemTicket,
  useResponderTicket,
  useRespostasRapidas,
  useTicketCliente,
  validarAnexos,
} from '../api/tickets'
import { cn } from '../lib/cn'
import { dataHora, hora, relativo, tamanhoArquivo, useAgora } from '../lib/formato'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button, buttonVariants } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Label, Textarea } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { PilulaPrioridade, PilulaStatus } from './componentes'

// ---------------------------------------------------------------------------
// Linha do tempo — o que o CLIENTE pode ver. O backend não entrega os eventos
// operacionais para o cliente (quem atribuiu, quem mencionou), então a linha
// nasce dos marcos do próprio ticket: aberto, primeira resposta, reaberto,
// aguardando você, resolvido/fechado.
// ---------------------------------------------------------------------------

interface Passo {
  id: string
  rotulo: string
  quando: string | null
  estado: 'feito' | 'atual' | 'futuro'
  tom?: 'ok' | 'alerta' | 'neutro'
}

function passosDoTicket(t: TicketDetalhe): Passo[] {
  const fechado = t.status === 'closed'
  const passos: Passo[] = [{ id: 'aberto', rotulo: 'Chamado aberto', quando: t.created_at, estado: 'feito' }]
  passos.push({
    id: 'resposta',
    rotulo: 'Primeira resposta',
    quando: t.first_response_at,
    estado: t.first_response_at ? 'feito' : fechado ? 'futuro' : 'atual',
  })
  if ((t.reopen_count ?? 0) > 0) {
    passos.push({ id: 'reaberto', rotulo: `Reaberto${t.reopen_count! > 1 ? ` (${t.reopen_count}×)` : ''}`, quando: t.last_reopened_at ?? null, estado: 'feito' })
  }
  if (t.status === 'pending_customer') {
    passos.push({ id: 'voce', rotulo: 'Aguardando sua resposta', quando: t.updated_at ?? null, estado: 'atual', tom: 'alerta' })
  } else if (t.status === 'open' && t.first_response_at) {
    passos.push({ id: 'andamento', rotulo: 'Em andamento', quando: null, estado: 'atual' })
  }
  passos.push({
    id: 'fim',
    rotulo: fechado ? (t.auto_closed ? 'Fechado automaticamente' : 'Resolvido') : 'Resolução',
    quando: t.closed_at ?? null,
    estado: fechado ? 'feito' : 'futuro',
    tom: fechado ? (t.auto_closed ? 'neutro' : 'ok') : undefined,
  })
  return passos
}

function LinhaDoTempo({ ticket }: { ticket: TicketDetalhe }) {
  const passos = passosDoTicket(ticket)
  return (
    <ol className="grid gap-4 sm:grid-cols-2 lg:flex lg:gap-0" aria-label="Linha do tempo do chamado">
      {passos.map((p, i) => {
        const ultimo = i === passos.length - 1
        return (
          <li key={p.id} className="relative flex gap-3 lg:flex-1 lg:flex-col lg:gap-2">
            <span className="flex flex-col items-center lg:w-full lg:flex-row">
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-total border-2 text-micro',
                  p.estado === 'feito' && 'border-ok bg-ok text-white',
                  p.estado === 'atual' && 'border-acento bg-acento-suave text-acento',
                  p.estado === 'atual' && p.tom === 'alerta' && 'border-alerta bg-alerta-suave text-alerta',
                  p.estado === 'feito' && p.tom === 'neutro' && 'border-neutro-400 bg-neutro-400',
                  p.estado === 'futuro' && 'border-divisoria bg-superficie text-tinta-terciaria',
                )}
                aria-hidden="true"
              >
                {p.estado === 'feito' ? <Check className="size-3.5" /> : p.estado === 'atual' ? <span className="size-2 rounded-total bg-current" /> : null}
              </span>
              {!ultimo && (
                <span className={cn('h-full min-h-4 w-0.5 flex-1 bg-divisoria lg:h-0.5 lg:min-h-0 lg:w-auto', p.estado === 'feito' && 'bg-ok/50')} />
              )}
            </span>
            <span className="min-w-0 pb-1 lg:pr-3">
              <span className={cn('block text-pequeno font-medio', p.estado === 'futuro' ? 'text-tinta-terciaria' : 'text-tinta', p.estado === 'atual' && p.tom === 'alerta' && 'text-alerta')}>
                {p.rotulo}
              </span>
              <span className="block text-legenda text-tinta-secundaria">{p.quando ? dataHora(p.quando) : p.estado === 'atual' ? 'agora' : '—'}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// Avaliação (CSAT do chamado) — só para o solicitante, só depois de resolvido
// ---------------------------------------------------------------------------

function AvaliacaoTicket({ ticketId }: { ticketId: number }) {
  const avaliar = useAvaliarTicket(ticketId)
  const [nota, setNota] = useState<number | null>(null)
  const [comentario, setComentario] = useState('')
  const idNota = useId()
  return (
    <Card className="border-ok/30 bg-ok-suave/40">
      <CardHeader>
        <CardTitle>Como foi o atendimento?</CardTitle>
        <p className="text-pequeno text-tinta-secundaria">De 0 (péssimo) a 10 (excelente). Sua nota vai para quem cuidou do chamado.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div role="radiogroup" aria-labelledby={idNota} className="flex flex-wrap gap-1.5">
          <span id={idNota} className="sr-only">
            Nota
          </span>
          {Array.from({ length: 11 }, (_, i) => i).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={nota === n}
              onClick={() => setNota(n)}
              className={cn(
                'grid size-9 place-items-center rounded-lg border border-divisoria bg-superficie text-corpo font-medio transition-colors hover:border-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40',
                nota === n && 'border-acento bg-acento text-acento-sobre',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idNota}-c`}>Comentário (opcional)</Label>
          <Textarea id={`${idNota}-c`} value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} maxLength={2000} placeholder="O que foi bem, o que podia ser melhor…" />
        </div>
        <div>
          <Button
            disabled={nota === null || avaliar.isPending}
            onClick={() =>
              avaliar.mutate(
                { score: nota!, comment: comentario.trim() },
                {
                  onSuccess: () => toast.success('Obrigado pela avaliação!'),
                  onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível enviar a avaliação.')),
                },
              )
            }
          >
            <CheckCircle2 /> {avaliar.isPending ? 'Enviando…' : 'Enviar avaliação'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

function agruparPorDia(msgs: Mensagem[], agoraMs: number): { rotulo: string; itens: Mensagem[] }[] {
  const grupos: { rotulo: string; itens: Mensagem[] }[] = []
  for (const m of msgs) {
    const rotulo = rotuloDia(m.created_at, agoraMs)
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.rotulo === rotulo) ultimo.itens.push(m)
    else grupos.push({ rotulo, itens: [m] })
  }
  return grupos
}

function Anexos({ msg }: { msg: Mensagem }) {
  if (!msg.attachments?.length) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Anexos">
      {msg.attachments.map((a) =>
        a.is_downloadable === false || !a.url ? (
          <li key={a.id} className="inline-flex items-center gap-1.5 rounded-lg border border-divisoria bg-navegacao px-2.5 py-1 text-legenda text-tinta-secundaria" title="Em verificação de segurança">
            <Lock className="size-3" aria-hidden="true" />
            {a.filename} · em verificação
          </li>
        ) : (
          <li key={a.id}>
            <a
              href={urlApi(a.url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-divisoria bg-superficie px-2.5 py-1 text-legenda text-acento hover:border-acento hover:bg-acento-suave"
            >
              <Paperclip className="size-3" aria-hidden="true" />
              {a.filename}
              {a.size_bytes ? <span className="text-tinta-terciaria">{tamanhoArquivo(a.size_bytes)}</span> : null}
            </a>
          </li>
        ),
      )}
    </ul>
  )
}

function Bolha({
  msg,
  agoraMs,
  onEditar,
  onExcluir,
}: {
  msg: Mensagem
  agoraMs: number
  onEditar: (m: Mensagem) => void
  onExcluir: (m: Mensagem) => void
}) {
  const doSuporte = msg.author_is_internal
  return (
    <article className={cn('flex gap-3', !doSuporte && 'flex-row-reverse')} aria-label={`Mensagem de ${msg.author_name}`}>
      <Avatar nome={msg.author_name} urlFoto={msg.author_avatar ? urlApi(msg.author_avatar) : null} tamanho="md" />
      <div className={cn('flex max-w-[85%] min-w-0 flex-col gap-1', !doSuporte && 'items-end')}>
        <div className="flex flex-wrap items-center gap-2 text-legenda text-tinta-secundaria">
          <span className="font-medio text-tinta">{msg.author_name}</span>
          {doSuporte && (
            <Badge variant="acento" className="px-1.5 py-0 text-micro">
              Suporte
            </Badge>
          )}
          <time dateTime={msg.created_at} title={dataHora(msg.created_at)}>
            {hora(msg.created_at)} · {relativo(msg.created_at, agoraMs)}
          </time>
          {msg.edited_at && <span className="italic">editada</span>}
        </div>
        <div
          className={cn(
            'rounded-xl px-4 py-3 text-corpo leading-normal shadow-elevacao-1',
            doSuporte ? 'rounded-tl-sm border border-divisoria bg-superficie text-tinta' : 'rounded-tr-sm bg-acento text-acento-sobre',
            msg.is_deleted && 'italic opacity-70',
          )}
        >
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{msg.is_deleted ? 'Mensagem apagada' : msg.body}</p>
          {!msg.is_deleted && <Anexos msg={msg} />}
        </div>
        {msg.can_edit && !msg.is_deleted && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-legenda" onClick={() => onEditar(msg)}>
              <Pencil className="!size-3" /> Editar
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-legenda hover:text-perigo" onClick={() => onExcluir(msg)}>
              <Trash2 className="!size-3" /> Excluir
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function EsqueletoTicket() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando chamado">
      <Skeleton className="h-4 w-24" />
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-5 w-40 rounded-total" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 p-6">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-3/4" />
        </CardContent>
      </Card>
    </div>
  )
}

export function PaginaTicket() {
  const { id } = useParams<{ id: string }>()
  const ticketId = Number(id)
  const agora = useAgora()
  const { data: ticket, isLoading, isError, error, refetch, isFetching } = useTicketCliente(ticketId)
  const { data: pendentes } = useAvaliacoesPendentesTicket()
  const { data: rapidas } = useRespostasRapidas('ticket')
  const responder = useResponderTicket(ticketId)
  const { editar, excluir } = useMensagemTicket(ticketId)
  const esperandoSuporte = ticket?.status === 'new' || ticket?.status === 'open'
  const { data: estimativa } = useEstimativaEquipe(esperandoSuporte && !ticket?.first_response_at ? ticket?.team?.slug : null)

  const [texto, setTexto] = useState('')
  const [anexos, setAnexos] = useState<File[]>([])
  const [erroAnexo, setErroAnexo] = useState<string | null>(null)
  const [reabrindo, setReabrindo] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [editando, setEditando] = useState<{ id: number; texto: string } | null>(null)
  const [excluindo, setExcluindo] = useState<Mensagem | null>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const inputAnexo = useRef<HTMLInputElement>(null)
  const idTexto = useId()

  // reabrir leva o foco ao texto
  useEffect(() => {
    if (reabrindo) areaRef.current?.focus()
  }, [reabrindo])

  if (isLoading) return <EsqueletoTicket />
  if (isError || !ticket) {
    const naoExiste = error instanceof ApiError && error.status === 404
    return (
      <div className="flex flex-col gap-4">
        <Link to="/portal/tickets" className="inline-flex items-center gap-1 text-pequeno text-tinta-secundaria hover:text-tinta">
          <ArrowLeft className="size-4" /> Tickets
        </Link>
        <Alert
          variant="destructive"
          titulo={naoExiste ? 'Este chamado não existe ou não é seu.' : 'Não foi possível carregar o chamado.'}
          acao={
            !naoExiste ? (
              <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
                Tentar de novo
              </Button>
            ) : undefined
          }
        >
          {naoExiste ? 'Confira o número na sua lista de tickets.' : 'Nada foi perdido — tente de novo em instantes.'}
        </Alert>
      </div>
    )
  }

  const fechado = ticket.status === 'closed'
  const podeReabrir = fechado && !ticket.auto_closed
  const compositorVisivel = !ticket.content_hidden && (!fechado || reabrindo)
  const aguardaAvaliacao = fechado && (pendentes ?? []).some((p) => p.ticket_id === ticket.id)
  const podeEnviar = (texto.trim().length > 0 || anexos.length > 0) && !responder.isPending
  const prazoResposta = !ticket.first_response_at && ticket.sla?.first_response?.due_at ? ticket.sla.first_response.due_at : null

  function enviar() {
    if (!podeEnviar) return
    responder.mutate(
      { body: texto.trim(), files: anexos },
      {
        onSuccess: () => {
          setTexto('')
          setAnexos([])
          setReabrindo(false)
          toast.success(podeReabrir && reabrindo ? 'Chamado reaberto com sua mensagem.' : 'Mensagem enviada ao suporte.')
        },
        onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível enviar.'), { description: 'Seu texto e os anexos continuam aqui.' }),
      },
    )
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      enviar()
    }
  }

  function adicionarAnexos(lista: FileList | null) {
    if (!lista) return
    const { aceitos, erro } = validarAnexos(Array.from(lista), anexos)
    setAnexos((a) => [...a, ...aceitos])
    setErroAnexo(erro)
  }

  async function exportarPdf() {
    setExportando(true)
    try {
      await baixarPdfDoTicket(ticket!.id, ticket!.reference)
      toast.success('PDF gerado', { description: `${ticket!.reference}.pdf` })
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.status === 501
          ? 'A exportação em PDF não está disponível neste servidor.'
          : mensagemDeErro(e, 'Não foi possível gerar o PDF.'),
      )
    } finally {
      setExportando(false)
    }
  }

  const grupos = agruparPorDia(ticket.messages, agora)

  return (
    <div className="flex flex-col gap-4">
      <Link to="/portal/tickets" className="inline-flex w-fit items-center gap-1 text-pequeno text-tinta-secundaria hover:text-tinta">
        <ArrowLeft className="size-4" aria-hidden="true" /> Tickets
      </Link>

      {/* ---------------- cabeçalho ---------------- */}
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <span className="fonte-mono text-pequeno text-acento">{ticket.reference}</span>
              <h1 className="mt-0.5 text-titulo font-forte leading-justa tracking-titulo">
                {ticket.content_hidden ? 'Chamado restrito' : ticket.subject}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <PilulaStatus ticket={ticket} />
                <PilulaPrioridade prioridade={ticket.priority} />
                {(ticket.reopen_count ?? 0) > 0 && (
                  <Badge variant="outline">
                    <RotateCcw className="size-3" aria-hidden="true" /> reaberto {ticket.reopen_count}×
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={exportarPdf} disabled={exportando || ticket.content_hidden}>
                <Download /> {exportando ? 'Gerando…' : 'Exportar PDF'}
              </Button>
              {podeReabrir && !reabrindo && (
                <Button size="sm" onClick={() => setReabrindo(true)}>
                  <RotateCcw /> Reabrir chamado
                </Button>
              )}
              {fechado && ticket.auto_closed && (
                <Link to="/portal/tickets/novo" className={buttonVariants({ size: 'sm' })}>
                  <Plus /> Abrir novo ticket
                </Link>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-pequeno sm:grid-cols-4">
            <div>
              <dt className="text-legenda text-tinta-secundaria">Aberto em</dt>
              <dd className="font-medio">{dataHora(ticket.created_at)}</dd>
            </div>
            <div>
              <dt className="text-legenda text-tinta-secundaria">Setor</dt>
              <dd className="inline-flex items-center gap-1 font-medio">
                <Users className="size-3.5 text-tinta-secundaria" aria-hidden="true" />
                {ticket.team?.name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-legenda text-tinta-secundaria">Categoria</dt>
              <dd className="inline-flex items-center gap-1 font-medio">
                <Tag className="size-3.5 text-tinta-secundaria" aria-hidden="true" />
                {ticket.category_name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-legenda text-tinta-secundaria">Nº do pedido</dt>
              <dd className="inline-flex items-center gap-1 font-medio">
                <Hash className="size-3.5 text-tinta-secundaria" aria-hidden="true" />
                {(ticket as { order_number?: string }).order_number || '—'}
              </dd>
            </div>
          </dl>

          {ticket.status === 'pending_customer' && (
            <Alert
              variant="warning"
              titulo="O suporte aguarda uma resposta sua"
              acao={
                <Button size="sm" onClick={() => areaRef.current?.focus()}>
                  Responder
                </Button>
              }
            >
              Sem retorno, o chamado pode ser encerrado automaticamente.
            </Alert>
          )}
          {esperandoSuporte && (prazoResposta || estimativa?.label) && (
            <p className="inline-flex items-center gap-2 rounded-lg bg-acento-suave px-3 py-2 text-pequeno text-tinta">
              <Clock className="size-4 text-acento" aria-hidden="true" />
              {prazoResposta ? (
                <>
                  Resposta prevista até <strong>{dataHora(prazoResposta)}</strong>
                </>
              ) : (
                <>
                  O suporte costuma responder em <strong>{estimativa!.label}</strong>
                </>
              )}
            </p>
          )}
          {fechado && ticket.auto_closed && (
            <Alert variant="info" titulo="Este chamado foi encerrado automaticamente por falta de retorno.">
              Ele não pode ser reaberto — se o problema continua, abra um novo ticket e cite o número {ticket.reference}.
            </Alert>
          )}
          {ticket.content_hidden && (
            <Alert variant="warning" titulo="Chamado restrito ao solicitante">
              Só quem abriu este chamado vê a conversa.
            </Alert>
          )}
        </CardHeader>
        <CardContent>
          <LinhaDoTempo ticket={ticket} />
        </CardContent>
      </Card>

      {aguardaAvaliacao && <AvaliacaoTicket ticketId={ticket.id} />}
      {fechado && !aguardaAvaliacao && !ticket.auto_closed && (ticket as { satisfaction?: { score: number | null } | null }).satisfaction?.score != null && (
        <p className="inline-flex items-center gap-2 text-pequeno text-tinta-secundaria">
          <ShieldCheck className="size-4 text-ok" aria-hidden="true" />
          Você avaliou este atendimento com nota {(ticket as { satisfaction?: { score: number | null } }).satisfaction!.score}.
        </p>
      )}

      {/* ---------------- conversa ---------------- */}
      {!ticket.content_hidden && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Conversa</CardTitle>
            <span className="text-legenda text-tinta-secundaria">
              {ticket.messages.length} mensage{ticket.messages.length === 1 ? 'm' : 'ns'}
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {grupos.length === 0 && <p className="text-pequeno text-tinta-secundaria">Nenhuma mensagem ainda.</p>}
            {grupos.map((g) => (
              <section key={g.rotulo} className="flex flex-col gap-4" aria-label={g.rotulo}>
                <h3 className="flex items-center gap-3 text-legenda font-medio uppercase tracking-rotulo text-tinta-secundaria before:h-px before:flex-1 before:bg-divisoria after:h-px after:flex-1 after:bg-divisoria">
                  {g.rotulo}
                </h3>
                {g.itens.map((m) =>
                  editando?.id === m.id ? (
                    <div key={m.id} className="ml-auto flex w-full max-w-[85%] flex-col gap-2">
                      <Textarea
                        value={editando.texto}
                        onChange={(e) => setEditando({ id: m.id, texto: e.target.value })}
                        aria-label="Editar mensagem"
                        autoFocus
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
                                onSuccess: () => {
                                  setEditando(null)
                                  toast.success('Mensagem editada.')
                                },
                                onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível editar.')),
                              },
                            )
                          }
                        >
                          <Check /> Salvar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Bolha
                      key={m.id}
                      msg={m}
                      agoraMs={agora}
                      onEditar={(x) => setEditando({ id: x.id, texto: x.body })}
                      onExcluir={setExcluindo}
                    />
                  ),
                )}
              </section>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ---------------- compositor ---------------- */}
      {compositorVisivel && (
        <Card className={cn(reabrindo && 'border-acento/40')}>
          <CardContent className="flex flex-col gap-3 p-5 md:p-6">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={idTexto}>{reabrindo ? 'Reabrir com uma mensagem' : 'Responder'}</Label>
              {reabrindo && (
                <Button variant="ghost" size="sm" onClick={() => setReabrindo(false)}>
                  <X /> Cancelar
                </Button>
              )}
            </div>
            {reabrindo && (
              <p className="text-pequeno text-tinta-secundaria">Sua mensagem reabre o chamado e volta para a fila do suporte.</p>
            )}

            {(rapidas?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2" aria-label="Respostas rápidas">
                {rapidas!.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setTexto((t) => (t.trim() ? `${t}\n${r.texto}` : r.texto))
                      areaRef.current?.focus()
                    }}
                    className="rounded-total border border-divisoria bg-superficie px-3 py-1 text-pequeno text-tinta-secundaria transition-colors hover:border-acento hover:bg-acento-suave hover:text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40"
                  >
                    {r.rotulo}
                  </button>
                ))}
              </div>
            )}

            <Textarea
              id={idTexto}
              ref={areaRef}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={aoTeclar}
              rows={4}
              placeholder={reabrindo ? 'Conte o que ainda não ficou resolvido…' : 'Escreva sua mensagem para o suporte…'}
            />

            {anexos.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Anexos a enviar">
                {anexos.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-lg border border-divisoria bg-navegacao px-2.5 py-1 text-legenda">
                    <Paperclip className="size-3 text-tinta-secundaria" aria-hidden="true" />
                    <span className="max-w-[200px] truncate">{f.name}</span>
                    <span className="text-tinta-terciaria">{tamanhoArquivo(f.size)}</span>
                    <button type="button" aria-label={`Remover ${f.name}`} onClick={() => setAnexos((a) => a.filter((_, j) => j !== i))} className="grid size-5 place-items-center rounded-md hover:bg-perigo-suave hover:text-perigo">
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {erroAnexo && (
              <p role="alert" className="text-legenda text-perigo">
                {erroAnexo}
              </p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => inputAnexo.current?.click()}>
                  <Paperclip /> Anexar
                </Button>
                <input
                  ref={inputAnexo}
                  type="file"
                  multiple
                  hidden
                  aria-label="Escolher arquivos"
                  onChange={(e) => {
                    adicionarAnexos(e.target.files)
                    e.target.value = ''
                  }}
                />
                <span className="text-legenda text-tinta-terciaria">Imagens e documentos até {LIMITE_ANEXO_MB} MB</span>
              </div>
              <Button onClick={enviar} disabled={!podeEnviar} title="Ctrl+Enter">
                <Send /> {responder.isPending ? 'Enviando…' : reabrindo ? 'Reabrir e enviar' : 'Enviar'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {fechado && !reabrindo && !ticket.auto_closed && !ticket.content_hidden && (
        <p className="inline-flex items-center gap-2 text-pequeno text-tinta-secundaria">
          <FileText className="size-4" aria-hidden="true" />
          Chamado resolvido{ticket.closed_at ? ` em ${dataHora(ticket.closed_at)}` : ''}. Ainda precisa de ajuda? Use “Reabrir chamado”.
        </p>
      )}

      <Dialog open={excluindo != null} onOpenChange={(aberto) => !aberto && setExcluindo(null)}>
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
                  onSuccess: () => {
                    setExcluindo(null)
                    toast.success('Mensagem excluída.')
                  },
                  onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível excluir.')),
                })
              }
            >
              <Trash2 /> Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
