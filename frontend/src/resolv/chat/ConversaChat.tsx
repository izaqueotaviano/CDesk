import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LIMITE_MENSAGENS,
  useBuscaNaConversa,
  useCarregarAnteriores,
  useCarregarAoRedor,
  useChat,
  useEditarMensagemChat,
  useMarcarLidas,
  useMensagensChat,
  useMidiaDoChat,
  usePegarChat,
  useReabrirChat,
  type ArquivoChat,
  type CitacaoChat,
  type MensagemChat,
} from '@/api/chat'
import { API_BASE_URL, ApiError } from '@/api/client'
import {
  destacar,
  ehImagemVisivel,
  estadoDaMensagem,
  iconeDoArquivo,
  ICONE_DO_ESTADO,
  motivoIndisponivel,
  imagensColadas,
  primeiraNaoLida,
  ROTULO_DO_ESTADO,
  TIPOS_ACEITOS,
  useFilaDeAnexos,
  type EnvioDeAnexo,
} from '@/chat/conversa'
import type { Me } from '@/api/types'
import { useSalaChat } from '@/realtime/useSalaChat'
import { fileSize } from '@/cvz/components/ChatWidget/ChatWidget'
import { useChatUi } from '@/stores/chatUi'
import { useAplicarMacroChat, useMacros, type Macro } from './dados'
import { indiceDeChat, tomDeChat } from './tons'
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
interface ContextoDaMacro {
  solicitante?: string
  empresa?: string
  agente?: string
  protocolo?: number
}

/** As variáveis que o chat sabe preencher, com o que cada uma vira. Fica
 *  exportada e visível no menu: uma marca que ninguém conhece nunca é usada,
 *  e uma que ninguém preenche vira `{{assim}}` na cara do cliente. */
const VARIAVEIS_DA_MACRO: { marca: string; explica: string }[] = [
  { marca: '{{solicitante}}', explica: 'primeiro nome do cliente' },
  { marca: '{{empresa}}', explica: 'empresa do cliente' },
  { marca: '{{agente}}', explica: 'seu primeiro nome' },
  { marca: '{{protocolo}}', explica: 'número do atendimento' },
  { marca: '{{saudacao}}', explica: 'bom dia / boa tarde / boa noite' },
]

/** Bom dia até 12h, boa tarde até 18h — pelo relógio de QUEM ESCREVE, que é
 *  o mesmo fuso do cliente na esmagadora maioria dos atendimentos. */
function saudacaoDaHora(agora: Date): string {
  const h = agora.getHours()
  if (h < 12) return 'bom dia'
  if (h < 18) return 'boa tarde'
  return 'boa noite'
}

function interpolarMacro(texto: string, ctx: ContextoDaMacro, agora: Date): string {
  return texto.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (original, chave: string) => {
    if (chave === 'solicitante' && ctx.solicitante) return ctx.solicitante.trim().split(/\s+/)[0] ?? ''
    if (chave === 'empresa' && ctx.empresa) return ctx.empresa
    if (chave === 'agente' && ctx.agente) return ctx.agente.trim().split(/\s+/)[0] ?? ''
    if (chave === 'protocolo' && ctx.protocolo != null) return `#${ctx.protocolo}`
    if (chave === 'saudacao') return saudacaoDaHora(agora)
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
  recusado: 'Sem acesso — recarregue a página',
} as const

/** Quanto tempo entre dois sinais de "digitando" mandados pra sala. */
const INTERVALO_DIGITANDO_MS = 2_000

function Anexo({ arquivo, destacado = false }: { arquivo: ArquivoChat; destacado?: boolean }) {
  const indisponivel = motivoIndisponivel(arquivo)
  // "Ver na conversa" no painel de mídia: a rolagem chega perto, e este
  // marca-texto diz QUAL — numa mensagem com três anexos, chegar não basta.
  const marca = destacado ? ' cc-anexo--destaque' : ''
  if (indisponivel) {
    // O motivo por extenso, não o nome do estado: cada caso pede uma ação
    // diferente (esperar, reenviar, desistir) e "bloqueado" não diz qual.
    return (
      <span className={"cc-anexo cc-anexo--bloqueado" + marca}>
        <i className="ti ti-shield" aria-hidden="true" />
        {arquivo.filename} · {indisponivel}
      </span>
    )
  }
  // Miniatura só depois que a varredura LIBEROU: renderizar a imagem antes
  // disso seria servir o arquivo em quarentena pela porta da frente, que é
  // justamente o que a quarentena existe para impedir (D19).
  if (ehImagemVisivel(arquivo)) {
    return (
      <a
        className={"cc-anexo cc-anexo--imagem" + marca}
        href={`${API_BASE_URL}${arquivo.url}`}
        target="_blank"
        rel="noreferrer"
        title={`${arquivo.filename} · ${fileSize(arquivo.size_bytes)}`}
      >
        <img src={`${API_BASE_URL}${arquivo.url}`} alt={arquivo.filename} loading="lazy" />
      </a>
    )
  }
  return (
    <a className={"cc-anexo" + marca} href={`${API_BASE_URL}${arquivo.url}`} target="_blank" rel="noreferrer">
      {/* ícone pelo TIPO detectado no servidor, não pela extensão do nome */}
      <i className={'ti ' + iconeDoArquivo(arquivo.content_type)} aria-hidden="true" />
      {arquivo.filename} · {fileSize(arquivo.size_bytes)}
    </a>
  )
}

/** O trecho citado dentro do balão. Clicar leva à mensagem original — que
 *  pode estar fora do que já foi carregado, e aí quem chama busca a janela. */
function Citacao({ citacao, onIr }: { citacao: CitacaoChat; onIr: () => void }) {
  return (
    <button type="button" className="cc-msg__citacao" onClick={onIr}>
      <span className="cc-msg__citacao-autor">{citacao.author_name}</span>
      <span className="cc-msg__citacao-corpo">
        {citacao.is_deleted ? (
          <em>Mensagem apagada</em>
        ) : (
          citacao.excerpt || (citacao.has_files ? 'Anexo' : '')
        )}
      </span>
    </button>
  )
}

/** O corpo com os trechos da busca em <mark> — sem regex montada com o que
 *  a pessoa digitou (ver `destacar`). */
function Corpo({ texto, termo, marcar = '' }: { texto: string; termo: string; marcar?: string }) {
  // `marcar` é o link vindo do painel ("ver na conversa"): entra como
  // marca-texto igual ao termo da busca, mas com a própria classe — um é
  // "o que você procurou", o outro é "aqui está o que você clicou".
  const alvo = termo.trim() || marcar
  if (!alvo) return <>{texto}</>
  const classe = termo.trim() ? undefined : 'cc-marca-alvo'
  return (
    <>
      {destacar(texto, alvo).map((p, i) =>
        p.destacado ? <mark key={i} className={classe}>{p.texto}</mark> : <span key={i}>{p.texto}</span>,
      )}
    </>
  )
}

type ItemDaLista = { tipo: 'dia'; rotulo: string; chave: string } | { tipo: 'msg'; msg: MensagemChat }

/** Uma mensagem na rolagem. Exportada porque a thread por cliente desenha
 *  o histórico das aberturas anteriores com a MESMA bolha — dois desenhos
 *  para a mesma coisa seria a garantia de divergirem. */
export function Bolha({
  msg,
  termo = '',
  ehMinha = false,
  emFoco = false,
  destaque = null,
  onResponder,
  onEditar,
  onIrPara,
}: {
  msg: MensagemChat
  /** Termo da busca — destaca os trechos que casam. */
  termo?: string
  /** Escrita por MIM: é a única que ganha o indicador de estado. */
  ehMinha?: boolean
  /** Resultado da busca em que a navegação está agora. */
  emFoco?: boolean
  /** "Ver na conversa" do painel de mídia: `arquivo:<id>` marca o anexo, uma
   *  URL marca o link no texto, `''` só a mensagem. `null` = nada. */
  destaque?: string | null
  onResponder?: (msg: MensagemChat) => void
  /** Só some quando `msg.can_edit` (autor + é a última da sessão + não
   *  apagada — mesma regra do painel do cliente, ver `chat_service`). */
  onEditar?: (msg: MensagemChat) => void
  onIrPara?: (id: number) => void
}) {
  if (msg.is_system) {
    return (
      <div className="cc-msg cc-msg--sistema" data-msg={msg.id}>
        <span>{msg.body}</span>
        <time>{horaDe(msg.sent_at)}</time>
      </div>
    )
  }
  const estado = estadoDaMensagem(msg)
  return (
    <div
      className={
        'cc-msg' +
        (msg.author_is_internal ? ' cc-msg--agente' : '') +
        (msg.is_internal_note ? ' cc-msg--nota' : '') +
        (emFoco ? ' cc-msg--achada' : '') +
        (destaque != null ? ' cc-msg--destaque' : '')
      }
      data-msg={msg.id}
    >
      <span className="cc-msg__avatar" {...tomDeChat(msg.author_name)}>{iniciais(msg.author_name)}</span>
      <div className="cc-msg__corpo">
        <div className="cc-msg__meta">
          <span className="cc-msg__autor">{msg.author_name}</span>
          <time>{horaDe(msg.sent_at)}</time>
          {msg.edited_at && <em>editada</em>}
          {/* dito por extenso, não só pela cor de fundo: é a diferença entre
              "a equipe lê isto" e "o cliente lê isto" */}
          {msg.is_internal_note && (
            <span className="cc-msg__selo-nota">
              <i className="ti ti-lock" aria-hidden="true" /> Nota interna — o cliente não vê
            </span>
          )}
          {onResponder && !msg.is_deleted && (
            <button
              type="button"
              className="cc-msg__responder"
              aria-label={`Responder à mensagem de ${msg.author_name}`}
              title="Responder"
              onClick={() => onResponder(msg)}
            >
              <i className="ti ti-arrow-back-up" aria-hidden="true" />
            </button>
          )}
          {onEditar && msg.can_edit && !msg.is_deleted && (
            <button
              type="button"
              className="cc-msg__responder"
              aria-label="Editar esta mensagem"
              title="Editar — só a última mensagem enviada, antes de chegar resposta"
              onClick={() => onEditar(msg)}
            >
              <i className="ti ti-pencil" aria-hidden="true" />
            </button>
          )}
        </div>
        {msg.reply_preview && onIrPara && (
          <Citacao citacao={msg.reply_preview} onIr={() => onIrPara(msg.reply_preview!.id)} />
        )}
        {/* só anexo, sem texto: não desenha balão vazio em cima do arquivo */}
        {(msg.is_deleted || msg.body) && (
          <div className={'cc-msg__balao' + (msg.is_deleted ? ' cc-msg__balao--apagada' : '')}>
            {msg.is_deleted ? (
              <em>Mensagem apagada</em>
            ) : (
              <Corpo
                texto={msg.body}
                termo={termo}
                marcar={destaque && !destaque.startsWith('arquivo:') ? destaque : ''}
              />
            )}
          </div>
        )}
        {msg.files.length > 0 && (
          <div className="cc-msg__anexos">
            {msg.files.map((f) => (
              <Anexo key={f.id} arquivo={f} destacado={destaque === `arquivo:${f.id}`} />
            ))}
          </div>
        )}
        {/* nota interna não tem escada de entrega: não há destinatário para
            receber nem para ler, e "Enviada" para sempre seria uma promessa
            sobre alguém que não existe */}
        {ehMinha && !msg.is_deleted && !msg.is_internal_note && (
          <span className={'cc-msg__estado cc-msg__estado--' + estado}>
            <i className={'ti ' + ICONE_DO_ESTADO[estado]} aria-hidden="true" />
            {/* o rótulo por extenso, não só o ícone e a cor (item 22) */}
            {ROTULO_DO_ESTADO[estado]}
          </span>
        )}
      </div>
    </div>
  )
}

/** Um envio em andamento, ainda fora da thread: barra, cancelar e repetir. */
function LinhaDeEnvio({
  envio,
  onCancelar,
  onRepetir,
  onDescartar,
}: {
  envio: EnvioDeAnexo
  onCancelar: (id: string) => void
  onRepetir: (id: string) => void
  onDescartar: (id: string) => void
}) {
  const pct = Math.round(envio.progresso * 100)
  return (
    <div className={'cc-envio cc-envio--' + envio.estado}>
      {envio.previa ? (
        <img className="cc-envio__previa" src={envio.previa} alt="" />
      ) : (
        <i className={'ti cc-envio__icone ' + iconeDoArquivo(envio.arquivo.type)} aria-hidden="true" />
      )}
      <div className="cc-envio__texto">
        <span className="cc-envio__nome">{envio.arquivo.name}</span>
        {envio.estado === 'erro' ? (
          <span className="cc-envio__erro">{envio.erro}</span>
        ) : (
          <progress className="cc-envio__barra" value={pct} max={100}>
            {pct}%
          </progress>
        )}
      </div>
      {envio.estado === 'erro' ? (
        <>
          <button type="button" onClick={() => onRepetir(envio.id)}>
            Tentar de novo
          </button>
          <button type="button" onClick={() => onDescartar(envio.id)} aria-label="Descartar envio">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => onCancelar(envio.id)}
          aria-label={`Cancelar envio de ${envio.arquivo.name}`}
        >
          Cancelar
        </button>
      )}
    </div>
  )
}

interface Props {
  chatId: number
  me: Me | undefined
  /** Dentro de um painel do mini chat: sem o cabeçalho grande (o painel já
   *  mostra quem é) e com espaçamento mais apertado. */
  compacto?: boolean
  /**
   * O que veio ANTES desta abertura, desenhado no topo da mesma rolagem.
   *
   * É como a thread por cliente do console mostra os atendimentos passados
   * sem abrir uma segunda caixa de mensagens: quem monta o trecho é quem
   * conhece o histórico (`ThreadDoCliente`); aqui ele só entra acima da
   * conversa de agora, dentro do mesmo scroll — uma rolagem só, um
   * compositor só.
   */
  historico?: ReactNode
}

/**
 * A conversa aberta — para quem ATENDE. Ler, todo interno pode (é o que
 * permite supervisão); escrever, só quem pegou: o compositor só aparece
 * quando o backend aceitaria a mensagem (`can_send`), e nos outros casos
 * a tela diz o que fazer em vez de deixar um botão que ia falhar.
 */
export function ConversaChat({ chatId, me, compacto = false, historico }: Props) {
  const idBase = useId()
  const navigate = useNavigate()
  const { data: chat, isLoading, isError } = useChat(chatId)
  const { data: mensagens, dataUpdatedAt } = useMensagensChat(chatId)
  // "agora" das faixas de dia = instante do último fetch, não Date.now()
  // em render (impuro) — o mesmo padrão da lista de tickets
  const agoraMs = dataUpdatedAt || 0
  const {
    status,
    digitando,
    erro: erroSocket,
    enviarMensagem,
    enviarDigitando,
    confirmarEntrega,
  } = useSalaChat(chatId)
  const anexos = useFilaDeAnexos(chatId)
  const marcarLidas = useMarcarLidas(chatId)
  const carregarAnteriores = useCarregarAnteriores(chatId)
  const pegar = usePegarChat()
  const reabrir = useReabrirChat(chatId)
  const { data: macros } = useMacros()
  const aplicarMacro = useAplicarMacroChat(chatId)
  const editar = useEditarMensagemChat(chatId)

  // Rascunho POR CONVERSA, compartilhado com o mini chat (stores/chatUi):
  // o que se digita aqui aparece lá e vice-versa — a mesma conversa pode ser
  // respondida de onde for melhor, e trocar de tela não perde o texto.
  const texto = useChatUi((s) => s.rascunhos[chatId] ?? '')
  const definirRascunho = useChatUi((s) => s.definirRascunho)
  const limparRascunho = useChatUi((s) => s.limparRascunho)
  const setTexto = (valor: string) => definirRascunho(chatId, valor)
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [fimDoHistorico, setFimDoHistorico] = useState(false)
  const inputAnexo = useRef<HTMLInputElement>(null)
  // Mensagem (e anexo/link dentro dela) que o "ver na conversa" acabou de
  // apontar — marca-texto passageiro, ver `irPara`.
  const [destaque, setDestaque] = useState<{ id: number; alvo: string } | null>(null)
  const apagarDestaque = useRef<number | undefined>(undefined)
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

  // Busca na conversa: `termo` é o que já foi submetido (o campo tem estado
  // próprio) e `posicao` é em qual ocorrência a navegação está.
  const [buscando, setBuscando] = useState(false)
  const [rascunhoBusca, setRascunhoBusca] = useState('')
  const [termo, setTermo] = useState('')
  const [posicao, setPosicao] = useState(0)
  const [painelMidia, setPainelMidia] = useState(false)
  const [respondendo, setRespondendo] = useState<MensagemChat | null>(null)
  const [editando, setEditando] = useState<{ id: number; texto: string } | null>(null)
  // Nota interna: MESMO rascunho da mensagem normal, de propósito. Quem
  // começou a escrever e percebeu no meio que aquilo é recado para a equipe
  // não deveria perder o texto ao trocar o modo.
  const [modoNota, setModoNota] = useState(false)
  const achados = useBuscaNaConversa(termo.length >= 2 ? chatId : null, termo)
  const irAoRedor = useCarregarAoRedor(chatId)
  const midia = useMidiaDoChat(chatId, painelMidia)

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

  // Régua "Novas mensagens": calculada UMA vez, na abertura da conversa, e
  // congelada. Recalcular a cada render faria a linha subir sozinha conforme
  // as mensagens vão sendo marcadas como lidas — exatamente o oposto do que
  // ela serve, que é lembrar onde a leitura parou.
  const temMensagens = (mensagens?.length ?? 0) > 0
  const regua = useMemo(
    () => (mensagens?.length ? primeiraNaoLida(mensagens, me?.is_internal === true) : null),
    // Dependências ESTREITAS de propósito — congela na abertura da conversa.
    // Com `mensagens` na lista, cada chegada nova recalcularia e a régua
    // pularia para a última mensagem enquanto a pessoa ainda lê as de cima,
    // que é o oposto do que ela serve. Trocar de chat remonta o componente
    // (`key={chatId}` em PaginaChat), então a régua nasce certa de novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [temMensagens, chatId],
  )

  // Confirma a ENTREGA do que chegou do outro lado. Entregue é o aparelho,
  // lida é a pessoa: as duas coisas existem separadas de propósito, e esta
  // roda mesmo com a aba escondida — a mensagem chegou aqui de qualquer jeito.
  useEffect(() => {
    if (!mensagens) return
    const pendentes = mensagens
      .filter((m) => !m.is_system && m.delivered_at === null && m.author_is_internal !== (me?.is_internal === true))
      .map((m) => m.id)
    confirmarEntrega(pendentes)
  }, [mensagens, me?.is_internal, confirmarEntrega])

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

  // erro e "fim do histórico" são POR conversa — quem troca de chat remonta
  // este componente (`key={chatId}` em PaginaChat), então esse estado nasce
  // zerado sem precisar de efeito de reset. O rascunho NÃO zera: mora no
  // store, de propósito (ver acima).

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
    enviarMensagem(texto.trim(), respondendo?.id ?? null, modoNota)
    setRespondendo(null)
    // o modo NÃO se desliga sozinho: quem está anotando o atendimento
    // costuma escrever mais de uma linha, e voltar para "público" a cada
    // envio é o caminho curto para mandar a segunda nota ao cliente
    enviarDigitando(false)
    limparRascunho(chatId)
  }

  function aoDigitar(valor: string) {
    setTexto(valor)
    const agora = Date.now()
    if (agora - ultimoSinalDigitando.current > INTERVALO_DIGITANDO_MS) {
      ultimoSinalDigitando.current = agora
      enviarDigitando(true)
    }
  }

  function anexar(arquivos: File[] | FileList | null) {
    const lista = arquivos ? Array.from(arquivos) : []
    if (lista.length === 0) return
    setErroAcao(null)
    // O erro de UM arquivo agora mora na própria linha da fila (com
    // "tentar de novo"), não numa faixa de erro que some ao mandar o
    // seguinte — por isso aqui não há mais `onError` global.
    anexos.enviar(lista, {
      texto: texto.trim() || undefined,
      replyTo: respondendo?.id ?? null,
      notaInterna: modoNota,
    })
    limparRascunho(chatId)
    setRespondendo(null)
  }

  /** Ctrl+V com um print na área de transferência vira anexo. */
  function colar(e: React.ClipboardEvent) {
    const imagens = imagensColadas(e.clipboardData?.items ?? null, new Date())
    if (imagens.length === 0) return
    e.preventDefault()
    anexar(imagens)
  }

  /** Leva a thread até uma mensagem; se ela ainda não foi carregada, busca a
   *  janela ao redor antes — é o que faz o achado antigo ser alcançável. */
  function irPara(id: number, alvo = '') {
    const rolar = () => {
      const el = document.querySelector(`[data-msg="${id}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      // o marca-texto fica o bastante para o olho achar e sai sozinho —
      // uma marca permanente viraria ruído na próxima leitura
      setDestaque({ id, alvo })
      window.clearTimeout(apagarDestaque.current)
      apagarDestaque.current = window.setTimeout(() => setDestaque(null), 3500)
    }
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

  function usarMacro(m: Macro) {
    // `usarMacro` só é chamada de dentro do JSX abaixo do `if (!chat) return`
    // acima — mas é uma função aninhada, e o TS não propaga a checagem de
    // null-safety do escopo externo para dentro do fechamento.
    if (!chat) return
    setMenuMacro(false)
    setFiltroMacro('')
    setMacroAtiva(0)
    const corpo = interpolarMacro(
      m.body ?? '',
      {
        solicitante: chat.client_name,
        empresa: chat.company_name,
        agente: me?.full_name,
        protocolo: chat.id,
      },
      new Date(),
    )
    if (corpo) setTexto(texto.trim() ? `${texto}\n${corpo}` : corpo)
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
      // a cor do atendimento (a mesma do avatar da pessoa) numa linha no topo:
      // com várias conversas abertas no dia, o olho acha pela cor
      <header className="cc-conversa__header" style={{ borderTop: `3px solid var(--chat-tom-${indiceDeChat(chat.client_name)})` }}>
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
            {/* "o cliente ainda está na tela?" é a pergunta que decide entre
                esperar a resposta e encerrar — some quando a conversa fecha */}
            {chat.status === 'active' && chat.client_presence && (
              <span className={'cc-conversa__presenca cc-conversa__presenca--' + chat.client_presence}>
                <i className="ti ti-point-filled" aria-hidden="true" />
                {chat.client_presence === 'available'
                  ? 'cliente na tela'
                  : chat.client_presence === 'away'
                    ? 'cliente ausente'
                    : 'cliente offline'}
              </span>
            )}
          </p>
        </div>
        <div className="cc-conversa__acoes-topo">
          <button
            type="button"
            className={'cc-conversa__icone' + (buscando ? ' cc-conversa__icone--ativo' : '')}
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
            <i className="ti ti-search" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={'cc-conversa__icone' + (painelMidia ? ' cc-conversa__icone--ativo' : '')}
            aria-label="Anexos e links da conversa"
            aria-expanded={painelMidia}
            title="Anexos e links da conversa"
            onClick={() => setPainelMidia((v) => !v)}
          >
            <i className="ti ti-photo" aria-hidden="true" />
          </button>
          <span className={'cc-conversa__socket cc-conversa__socket--' + status} title={ROTULO_STATUS_SOCKET[status]}>
            <i className="ti ti-point" />
            {ROTULO_STATUS_SOCKET[status]}
          </span>
        </div>
      </header>
      )}

      {buscando && !compacto && (
        <form
          className="cc-busca"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            setTermo(rascunhoBusca)
            setPosicao(0)
          }}
        >
          <label className="cc-visualmente-oculto" htmlFor={`${idBase}-busca`}>
            Termo da busca
          </label>
          <input
            id={`${idBase}-busca`}
            type="search"
            autoFocus
            value={rascunhoBusca}
            placeholder="Procurar na conversa inteira"
            onChange={(e) => setRascunhoBusca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setBuscando(false)
                setTermo('')
                setRascunhoBusca('')
              }
            }}
          />
          <button type="submit" disabled={rascunhoBusca.trim().length < 2}>
            Buscar
          </button>
          {termo.length >= 2 && (
            <>
              <span className="cc-busca__contagem" role="status">
                {achados.isLoading
                  ? 'procurando…'
                  : resultados.length === 0
                    ? 'nada encontrado'
                    : `${posicao + 1} de ${resultados.length}`}
              </span>
              <button
                type="button"
                aria-label="Resultado anterior"
                disabled={resultados.length === 0}
                onClick={() => navegarBusca(-1)}
              >
                <i className="ti ti-chevron-up" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Próximo resultado"
                disabled={resultados.length === 0}
                onClick={() => navegarBusca(1)}
              >
                <i className="ti ti-chevron-down" aria-hidden="true" />
              </button>
            </>
          )}
          {/* A busca é do SERVIDOR: acha o que está no histórico inteiro,
              inclusive o que esta tela ainda não baixou. Por isso o aviso
              abaixo — o resultado pode estar fora do trecho visível. */}
          <p className="cc-busca__ajuda">Procura na conversa inteira, não só no que está na tela.</p>
        </form>
      )}

      <div className="cc-conversa__mensagens">
        {historico}
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
              <div key={item.msg.id}>
                {item.msg.id === regua && (
                  <div className="cc-conversa__regua" role="separator">
                    <span>Novas mensagens</span>
                  </div>
                )}
                {editando?.id === item.msg.id ? (
                  <div className="cc-msg-editar">
                    <textarea
                      className="cc-msg-editar__texto"
                      value={editando.texto}
                      onChange={(e) => setEditando({ id: item.msg.id, texto: e.target.value })}
                      autoFocus
                      rows={2}
                      aria-label="Editar mensagem"
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setEditando(null)
                        }
                      }}
                    />
                    <div className="cc-msg-editar__acoes">
                      <button type="button" onClick={() => setEditando(null)}>
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="cc-msg-editar__salvar"
                        disabled={!editando.texto.trim() || editar.isPending}
                        onClick={() =>
                          editar.mutate(
                            { id: editando.id, body: editando.texto.trim() },
                            {
                              onSuccess: () => setEditando(null),
                              onError: (e) =>
                                setErroAcao(
                                  e instanceof ApiError ? (e.detail ?? 'Não foi possível editar.') : 'Não foi possível editar.',
                                ),
                            },
                          )
                        }
                      >
                        <i className="ti ti-check" aria-hidden="true" /> Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <Bolha
                    msg={item.msg}
                    termo={termo}
                    ehMinha={me != null && item.msg.author_is_internal === me.is_internal && !item.msg.is_system}
                    emFoco={resultados[posicao]?.id === item.msg.id}
                    destaque={destaque?.id === item.msg.id ? destaque.alvo : null}
                    onResponder={podeEscrever ? setRespondendo : undefined}
                    onEditar={podeEscrever ? (m) => setEditando({ id: m.id, texto: m.body }) : undefined}
                    onIrPara={irPara}
                  />
                )}
              </div>
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

      {painelMidia && !compacto && (
        <aside className="cc-midia" aria-label="Anexos e links desta conversa">
          <h2>Nesta conversa</h2>
          {midia.isLoading && <p className="cc-midia__vazio">Carregando…</p>}
          {midia.data && midia.data.files.length === 0 && midia.data.links.length === 0 && (
            <p className="cc-midia__vazio">Nenhum anexo ou link ainda.</p>
          )}
          {(midia.data?.files.length ?? 0) > 0 && (
            <>
              <h3>Arquivos</h3>
              <ul className="cc-midia__lista">
                {midia.data!.files.map((f) => (
                  <li key={f.id}>
                    <button type="button" className="cc-midia__ir" onClick={() => irPara(f.message_id, `arquivo:${f.id}`)}>
                      <i className={'ti ' + (f.content_type.startsWith('image/') ? 'ti-photo' : 'ti-file')} aria-hidden="true" />
                      <span className="cc-midia__nome">{f.filename}</span>
                      <span className="cc-midia__meta">{fileSize(f.size_bytes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {(midia.data?.links.length ?? 0) > 0 && (
            <>
              <h3>Links</h3>
              <ul className="cc-midia__lista">
                {midia.data!.links.map((l) => (
                  <li key={`${l.message_id}-${l.url}`}>
                    <a href={l.url} target="_blank" rel="noreferrer noopener" className="cc-midia__link">
                      <i className="ti ti-link" aria-hidden="true" />
                      <span className="cc-midia__nome">{l.url}</span>
                    </a>
                    <button type="button" className="cc-link cc-midia__contexto" onClick={() => irPara(l.message_id, l.url)}>
                      ver na conversa
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      )}

      {anexos.fila.length > 0 && (
        <div className="cc-envios" aria-label="Anexos em envio">
          {anexos.fila.map((envio) => (
            <LinhaDeEnvio
              key={envio.id}
              envio={envio}
              onCancelar={anexos.cancelar}
              onRepetir={anexos.repetir}
              onDescartar={anexos.descartar}
            />
          ))}
        </div>
      )}

      {aviso && (
        <p className="cc-conversa__aviso" role="status">
          <i className="ti ti-bolt" aria-hidden="true" /> {aviso}
        </p>
      )}
      {(erroAcao || erroSocket) && <p className="cc-conversa__erro">{erroAcao ?? erroSocket}</p>}

      {podeEscrever && (
        <div className={'cc-composer' + (modoNota ? ' cc-composer--nota' : '')}>
          {modoNota && (
            <p className="cc-composer__aviso-nota" role="status">
              <i className="ti ti-lock" aria-hidden="true" /> Isto vai para a EQUIPE. O
              cliente não vê nota interna.
            </p>
          )}
          {respondendo && (
            <div className="cc-composer__citando">
              <span className="cc-composer__citando-autor">
                Respondendo {respondendo.author_name}
              </span>
              <span className="cc-composer__citando-corpo">
                {respondendo.body || (respondendo.files.length > 0 ? 'Anexo' : '')}
              </span>
              <button
                type="button"
                aria-label="Cancelar resposta"
                onClick={() => setRespondendo(null)}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
          )}
          <textarea
            ref={areaRef}
            className="cc-composer__textarea"
            placeholder={
              !socketAberto
                ? 'Sem conexão — o texto espera a conexão voltar; anexos continuam indo.'
                : modoNota
                  ? 'Anotação para a equipe — o cliente não vê…'
                  : 'Escreva para o cliente… (Enter envia, Shift+Enter quebra linha, Ctrl+V cola print)'
            }
            value={texto}
            onChange={(e) => aoDigitar(e.target.value)}
            onPaste={colar}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && respondendo) {
                e.preventDefault()
                setRespondendo(null)
                return
              }
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
                title="Anexo vai por REST — funciona mesmo sem conexão de socket. Ctrl+V cola print."
                onClick={() => inputAnexo.current?.click()}
              >
                <i className="ti ti-paperclip" />
                Anexar
              </button>

              {/* `aria-pressed` e não um checkbox: é um interruptor de MODO do
                  compositor, e o que ele muda é para onde o texto vai. */}
              <button
                type="button"
                className={'cc-composer__anexar' + (modoNota ? ' cc-composer__anexar--nota' : '')}
                aria-pressed={modoNota}
                title={
                  modoNota
                    ? 'Voltar a escrever para o cliente'
                    : 'Escrever uma nota interna — o cliente não vê'
                }
                onClick={() => setModoNota((v) => !v)}
              >
                <i className="ti ti-lock" aria-hidden="true" /> Nota interna
              </button>
              <input
                ref={inputAnexo}
                type="file"
                multiple
                accept={TIPOS_ACEITOS}
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
                      {/* As variáveis ficam à vista: uma marca que ninguém
                          conhece nunca é usada, e uma que ninguém preenche vai
                          para o cliente escrita como `{{assim}}`. */}
                      <p className="cc-composer__macro-vars">
                        Variáveis:{' '}
                        {VARIAVEIS_DA_MACRO.map((v, i) => (
                          <span key={v.marca}>
                            {i > 0 && ' · '}
                            <code>{v.marca}</code> {v.explica}
                          </span>
                        ))}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              className={'cc-composer__enviar' + (modoNota ? ' cc-composer__enviar--nota' : '')}
              disabled={!podeEnviarTexto}
              onClick={enviar}
            >
              {modoNota ? 'Salvar nota' : 'Enviar'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
