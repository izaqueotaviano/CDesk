import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { IconArrowLeft, IconCheck, IconChevronDown, IconChevronUp, IconPaperclip, IconPencil, IconRotateClockwise, IconSearch, IconSend, IconTrash, IconX } from '@tabler/icons-react'
import {
  LIMITE_MENSAGENS,
  useBuscaNaConversa,
  useCarregarAnteriores,
  useCarregarAoRedor,
  useChat,
  useEditarMensagemChat,
  useConfigChat,
  useExcluirMensagemChat,
  useMarcarLidas,
  useMensagensChat,
  useReabrirChat,
  type MensagemChat,
} from '@/api/chat'
import { ApiError } from '@/api/client'
import {
  imagensColadas,
  primeiraNaoLida,
  TIPOS_ACEITOS,
  useFilaDeAnexos,
} from '@/chat/conversa'
import { rotuloDia, urlApi } from '@/resolv/tickets/detalhe/linhaDoTempo'
import { useSalaChat } from '@/realtime/useSalaChat'
import { Avatar } from '@/ui/Avatar'
import { cn } from '../lib/cn'
import { useAgora } from '../lib/formato'
import { ZonaDeSoltar } from '../tickets/AnexosDoFormulario'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { ErroEstado } from '../ui/estado-vazio'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import type { ChatDoCliente } from '../api/chats'
import { Mensagem, MensagemDoSistema, PilulaChat } from './componentes'
import { ModalAvaliacao } from './ModalAvaliacao'
import { AvisoDaFila } from './AvisoDaFila'
import { usePosicaoAoVivo } from './fila'

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
  'w-full rounded-md border border-borda-campo bg-superficie px-3 py-2 text-corpo text-tinta placeholder:text-tinta-terciaria hover:border-tinta-secundaria focus-visible:border-acento'

/**
 * A conversa: thread + composer. Texto vai pelo socket (trava sem conexão);
 * anexo sempre por REST — funciona mesmo com o socket caído, de propósito.
 * `onVoltar` só aparece no celular (a lista ocupa a largura toda lá).
 */
export function Conversa({
  chatId,
  onVoltar,
  onEncerrada,
}: {
  chatId: number
  onVoltar?: () => void
  /** O cliente encerrou avaliando. Quem mostra a confirmação é a página: ao
   *  fechar, este chat sai da consulta de "conversa viva" e a Conversa pode
   *  desmontar — ver `DialogConversaEncerrada`. */
  onEncerrada?: () => void
}) {
  const idBase = useId()
  const agora = useAgora()
  const { data: chatBruto, isError: erroChat } = useChat(chatId)
  const chat = chatBruto as ChatDoCliente | undefined
  const { data: configChat } = useConfigChat()
  const { data: mensagens, isLoading } = useMensagensChat(chatId)
  const {
    status,
    digitando,
    erro: erroSocket,
    enviarMensagem,
    enviarDigitando,
    confirmarEntrega,
  } = useSalaChat(chatId)
  const anexos = useFilaDeAnexos(chatId)
  const carregarAnteriores = useCarregarAnteriores(chatId)
  const reabrir = useReabrirChat(chatId)
  const marcarLidas = useMarcarLidas(chatId)
  const editar = useEditarMensagemChat(chatId)
  const excluir = useExcluirMensagemChat(chatId)
  usePosicaoAoVivo(chatId, chat?.status === 'queued')

  const [texto, setTexto] = useState('')
  const [confirmandoEncerrar, setConfirmandoEncerrar] = useState(false)
  const [editando, setEditando] = useState<{ id: number; texto: string } | null>(null)
  const [excluindo, setExcluindo] = useState<MensagemChat | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // A lista chega com as últimas LIMITE_MENSAGENS. Numa sessão mais longa as
  // anteriores existem no servidor mas não na tela — o botão busca de trás
  // pra frente até voltar vazio (o mesmo mecanismo do console).
  const [fimDoHistorico, setFimDoHistorico] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [rascunhoBusca, setRascunhoBusca] = useState('')
  const [termo, setTermo] = useState('')
  const [posicao, setPosicao] = useState(0)
  const [respondendo, setRespondendo] = useState<MensagemChat | null>(null)
  const achados = useBuscaNaConversa(termo.length >= 2 ? chatId : null, termo)
  const irAoRedor = useCarregarAoRedor(chatId)
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

  // A ENTREGA é confirmada mesmo com a aba escondida: chegou no aparelho é
  // uma coisa, a pessoa ter lido é outra — e é o `read/` acima que diz a
  // segunda.
  useEffect(() => {
    if (!mensagens) return
    confirmarEntrega(
      mensagens.filter((m) => !m.is_system && m.author_is_internal && m.delivered_at === null).map((m) => m.id),
    )
  }, [mensagens, confirmarEntrega])

  const temMensagens = (mensagens?.length ?? 0) > 0
  // Régua "Novas mensagens" congelada na abertura — com `mensagens` nas
  // dependências ela pularia para a última a cada chegada, enquanto a pessoa
  // ainda lê as de cima.
  const regua = useMemo(
    () => (mensagens?.length ? primeiraNaoLida(mensagens, false) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [temMensagens, chatId],
  )

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-3 p-4" aria-busy="true" aria-label="Carregando conversa">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  // Chat que não existe mais, ou não é do usuário logado (link antigo,
  // troca de sessão) — sem isto ficava preso no esqueleto de carregamento
  // pra sempre, escondendo o composer sem nenhuma explicação.
  if (erroChat || !chat) {
    return (
      <ErroEstado
        className="m-auto"
        titulo="Não foi possível abrir esta conversa"
        descricao="Ela pode não existir mais, ou não pertencer a você."
        onTentarNovamente={onVoltar}
      />
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
        ? { tom: 'perigo' as const, texto: 'Sessão expirada. Recarregue a página' }
        : { tom: 'alerta' as const, texto: 'Reconectando…' }

  function enviar() {
    if (!podeEnviarTexto) return
    enviarMensagem(texto.trim(), respondendo?.id ?? null)
    setRespondendo(null)
    enviarDigitando(false)
    setTexto('')
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape' && respondendo) {
      e.preventDefault()
      setRespondendo(null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  function anexar(arquivos: File[]) {
    if (arquivos.length === 0) return
    setErro(null)
    // O erro de UM arquivo mora na linha dele, com "tentar de novo" — não
    // numa faixa que some assim que o próximo termina.
    anexos.enviar(arquivos, { texto: texto.trim() || undefined, replyTo: respondendo?.id ?? null })
    setTexto('')
    setRespondendo(null)
  }

  /** Ctrl+V com um print na área de transferência vira anexo. */
  function colar(e: ClipboardEvent<HTMLTextAreaElement>) {
    const imagens = imagensColadas(e.clipboardData?.items ?? null, new Date())
    if (imagens.length === 0) return
    e.preventDefault()
    anexar(imagens)
  }

  /** Leva até uma mensagem, buscando a janela ao redor se ela ainda não foi
   *  carregada — é o que faz o achado antigo ser alcançável. */
  function irPara(id: number) {
    const rolar = () =>
      document.querySelector(`[data-msg="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (mensagens?.some((m) => m.id === id)) {
      rolar()
      return
    }
    irAoRedor.mutate(id, { onSuccess: () => setTimeout(rolar, 60) })
  }

  const resultados = achados.data ?? []
  function navegarBusca(passo: number) {
    if (resultados.length === 0) return
    const proximo = (posicao + passo + resultados.length) % resultados.length
    setPosicao(proximo)
    irPara(resultados[proximo].id)
  }


  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 p-4">
        {onVoltar && (
          <Button variant="ghost" size="icon-sm" onClick={onVoltar} aria-label="Voltar para a lista" className="md:hidden">
            <IconArrowLeft />
          </Button>
        )}
        {/* O avatar de quem atende, com a bolinha: "o Samuel ainda está
            aí?" é a pergunta que decide entre esperar e voltar depois. */}
        {chat.agent_name && (
          <Avatar
            nome={chat.agent_name}
            urlFoto={chat.agent_avatar ? urlApi(chat.agent_avatar) : null}
            tamanho="md"
            presenca={chat.agent_presence ?? null}
            fundo="superficie"
          />
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
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Buscar nesta conversa"
          aria-expanded={buscando}
          title="Buscar nesta conversa"
          onClick={() => {
            setBuscando((v) => !v)
            if (buscando) {
              setTermo('')
              setRascunhoBusca('')
            }
          }}
        >
          <IconSearch />
        </Button>
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

      {chat.status === 'queued' && chat.queue_position && (
        <AvisoDaFila posicao={chat.queue_position} className="border-t border-divisoria px-4 py-3" />
      )}

      {buscando && (
        <form
          role="search"
          className="flex flex-wrap items-center gap-2 border-t border-divisoria px-4 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            setTermo(rascunhoBusca)
            setPosicao(0)
          }}
        >
          <label className="sr-only" htmlFor={`${idBase}-busca`}>
            Termo da busca
          </label>
          <input
            id={`${idBase}-busca`}
            type="search"
            autoFocus
            value={rascunhoBusca}
            onChange={(e) => setRascunhoBusca(e.target.value)}
            placeholder="Procurar na conversa inteira"
            className={`${CAMPO} h-8 flex-1`}
          />
          <Button type="submit" size="sm" variant="outline" disabled={rascunhoBusca.trim().length < 2}>
            Buscar
          </Button>
          {termo.length >= 2 && (
            <>
              <span role="status" className="text-legenda text-tinta-secundaria">
                {achados.isLoading
                  ? 'procurando…'
                  : resultados.length === 0
                    ? 'nada encontrado'
                    : `${posicao + 1} de ${resultados.length}`}
              </span>
              <Button size="icon-sm" variant="ghost" aria-label="Resultado anterior" disabled={resultados.length === 0} onClick={() => navegarBusca(-1)}>
                <IconChevronUp />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Próximo resultado" disabled={resultados.length === 0} onClick={() => navegarBusca(1)}>
                <IconChevronDown />
              </Button>
            </>
          )}
          {/* Do SERVIDOR: acha no histórico inteiro, não só no que está na tela. */}
          <p className="w-full text-legenda text-tinta-terciaria">
            Procura na conversa inteira, não só no que está na tela.
          </p>
        </form>
      )}

      {/* fundo na rolagem: sobre ele o balão branco do suporte e o meu tingido viram figura, não linhas numa folha em branco */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-navegacao p-4">
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
              <h3 className="flex items-center gap-3 text-legenda font-medio text-tinta-secundaria before:h-px before:flex-1 before:bg-divisoria after:h-px after:flex-1 after:bg-divisoria">
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
                  <div key={m.id}>
                    {m.id === regua && (
                      <div
                        role="separator"
                        className="mb-2 flex items-center gap-3 text-legenda font-medio text-tinta before:h-px before:flex-1 before:bg-tinta-terciaria after:h-px after:flex-1 after:bg-tinta-terciaria"
                      >
                        Novas mensagens
                      </div>
                    )}
                  <Mensagem
                    msg={m}
                    termo={termo}
                    emFoco={resultados[posicao]?.id === m.id}
                    onResponder={aberta ? () => setRespondendo(m) : undefined}
                    onIrPara={irPara}
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
                  </div>
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
        <p className="px-4 py-2 text-pequeno text-tinta-secundaria">
          Esta conversa virou o ticket <strong className="text-tinta">{chat.ticket_reference}</strong>.
        </p>
      )}

      {(erro || erroSocket) && (
        <p role="alert" className="px-4 py-2 text-pequeno text-perigo">
          {erro ?? erroSocket}
        </p>
      )}

      {anexos.fila.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-divisoria p-3" aria-label="Anexos em envio">
          {anexos.fila.map((envio) => (
            <div
              key={envio.id}
              className={cn(
                'flex items-center gap-2 rounded-sm bg-navegacao px-2 py-1.5',
                envio.estado === 'erro' && 'bg-perigo-suave',
              )}
            >
              {envio.previa ? (
                <img src={envio.previa} alt="" className="size-8 rounded object-cover" />
              ) : (
                <IconPaperclip className="size-4 text-tinta-secundaria" aria-hidden="true" />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-legenda text-tinta">{envio.arquivo.name}</span>
                {envio.estado === 'erro' ? (
                  <span className="text-legenda text-perigo">{envio.erro}</span>
                ) : (
                  <progress
                    className="h-1 w-full"
                    value={Math.round(envio.progresso * 100)}
                    max={100}
                    aria-label={`Enviando ${envio.arquivo.name}`}
                  />
                )}
              </div>
              {envio.estado === 'erro' ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => anexos.repetir(envio.id)}>
                    Tentar de novo
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Descartar envio" onClick={() => anexos.descartar(envio.id)}>
                    <IconX />
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => anexos.cancelar(envio.id)}>
                  Cancelar
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {aberta && (
        // arrastar um arquivo para cá envia como anexo — o mesmo caminho do botão
        <ZonaDeSoltar onArquivos={anexar} className="flex flex-col gap-2 border-t border-divisoria p-3">
          {respondendo && (
            <div className="flex items-center gap-2 rounded-sm bg-navegacao px-2 py-1">
              <span className="shrink-0 text-legenda font-medio text-tinta">
                Respondendo {respondendo.author_is_internal ? respondendo.author_name : 'você mesmo'}
              </span>
              <span className="flex-1 truncate text-legenda text-tinta-secundaria">
                {respondendo.body || (respondendo.files.length > 0 ? 'Anexo' : '')}
              </span>
              <Button size="icon-sm" variant="ghost" aria-label="Cancelar resposta" onClick={() => setRespondendo(null)}>
                <IconX />
              </Button>
            </div>
          )}
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
            onPaste={colar}
            placeholder={socketAberto ? 'Escreva sua mensagem… (Ctrl+V cola um print)' : 'Sem conexão. O texto espera voltar; anexos continuam funcionando.'}
            aria-label="Escreva sua mensagem"
            className={`${CAMPO} resize-none`}
          />
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => inputAnexo.current?.click()}>
              <IconPaperclip /> Anexar
            </Button>
            <input
              ref={inputAnexo}
              type="file"
              multiple
              accept={TIPOS_ACEITOS}
              hidden
              aria-label="Escolher arquivos"
              onChange={(e) => {
                const arquivos = Array.from(e.target.files ?? [])
                e.target.value = ''
                anexar(arquivos)
              }}
            />
            {/* Botão invertido, como o `.cc-composer__enviar` do console: o azul de
                ação fica pro primário da tela, não pro "enviar" repetido a cada linha. */}
            <Button variant="inverse" onClick={enviar} disabled={!podeEnviarTexto} title="Enter envia, Shift+Enter quebra linha">
              <IconSend /> Enviar
            </Button>
          </div>
        </ZonaDeSoltar>
      )}

      {/* Encerrar É avaliar: o modal manda as duas notas junto do `close`, e o
          backend grava tudo numa transação — o chat só fecha se a nota gravar
          (item 1 do brief). Por isso não há mais um "tem certeza?" antes: a
          própria avaliação é a confirmação, e "Continuar conversando" desiste. */}
      {confirmandoEncerrar && (
        <ModalAvaliacao
          chat={chat}
          config={configChat}
          modo="encerrando"
          onCancelar={() => setConfirmandoEncerrar(false)}
          onEncerrada={() => {
            setConfirmandoEncerrar(false)
            onEncerrada?.()
          }}
        />
      )}

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
