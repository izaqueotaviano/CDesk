import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import type { Me } from '@/api/types'
import { imagensColadas, TIPOS_ACEITOS } from '@/chat/conversa'
import { useSistemaCfg } from '@/cvz/configuracoes/dados'
import { useTabs, type AbaTicket } from '@/stores/tabs'
import {
  alternarLista,
  aplicarNoCampo,
  continuarLista,
  envolver,
  inserirLink,
  type Edicao,
} from '@/ui/edicaoFormatada'
import { TextoFormatado } from '@/ui/TextoFormatado'
import { classeIconeDoArquivo, conferirAnexos, limitesDeAnexo } from '../anexos'
import { ROTULO_PRIORIDADE, ROTULO_STATUS, formatarDataHora } from '../format'
import type { StatusTicket } from '../tipos'
import { useCompositorColaborativo } from './colaboracao/useCompositorColaborativo'
import { usePreviasDeImagem, useSoltarArquivos } from '../useSoltarArquivos'
import { useAcoesTicket, useAlvosMencao, useMacros } from './dados'
import {
  STATUS_AO_ENVIAR,
  interpolarMacro,
  marcadoresPendentes,
  mensagemDeErro,
  paraDatetimeLocal,
  rotuloEnviar,
  statusInicialAoEnviar,
  tamanhoArquivo,
  validarFechamento,
} from './linhaDoTempo'
import {
  chaveDoAlvo,
  consultaDeMencao,
  filtrarAlvos,
  inserirMencao,
  paraMarcacao,
  type ConsultaMencao,
} from './mencoes'
import type { AlvoMencao, Macro, TicketDetalhe } from './tiposDetalhe'

const ROTULO_AO_ENVIAR: Record<StatusTicket, string> = {
  new: 'Novo',
  open: 'Aberto',
  pending_customer: 'Aguardando retorno do cliente',
  closed: 'Fechado',
}

/** Só os dois que não mexem no registro de trabalho técnico (D4): fechar num
 *  horário futuro exigiria as datas da solução agora, para um trabalho que
 *  ainda não terminou. Quem quer fechar fecha na hora. */
const STATUS_AGENDAVEIS: StatusTicket[] = ['open', 'pending_customer']

/** Atalho de envio escrito como a pessoa vê no próprio teclado. */
const EH_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const TECLA = EH_MAC ? '⌘' : 'Ctrl'

type Formato = 'negrito' | 'italico' | 'lista' | 'numerada' | 'link'

/** Os botões de formatação — o subconjunto que `ui/textoFormatado.ts`
 *  reconhece, nada além. O atalho entra no rótulo porque é lá que a pessoa
 *  descobre que ele existe. */
const FORMATOS: { id: Formato; icone: string; rotulo: string; atalho?: string }[] = [
  { id: 'negrito', icone: 'ti ti-bold', rotulo: 'Negrito', atalho: 'B' },
  { id: 'italico', icone: 'ti ti-italic', rotulo: 'Itálico', atalho: 'I' },
  { id: 'lista', icone: 'ti ti-list', rotulo: 'Lista com marcadores' },
  { id: 'numerada', icone: 'ti ti-list-numbers', rotulo: 'Lista numerada' },
  { id: 'link', icone: 'ti ti-link', rotulo: 'Link', atalho: 'K' },
]

const ROTULO_GRUPO_MENCAO: Record<string, string> = {
  ticket: 'No ticket',
  equipe: 'Da equipe',
  equipes: 'Equipe inteira',
}

/** "Envio de nota" acha "Envio de Nota"; "ACME" acha "acme". Mesma função,
 *  copiada — não importada — de novo/BuscaPessoa.tsx: a casa já aceita essa
 *  duplicação (BuscaPessoa e resolv/shell/BuscaComando.tsx têm cada uma a
 *  própria cópia) em vez de um utilitário compartilhado para três linhas. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Corpo que vai para `POST /tickets/{id}/reply/`.
 *
 * Anexar um print e enviar sem escrever é o gesto mais natural do suporte, e o
 * botão sempre acendeu para ele — mas `body` é obrigatório no
 * `TicketReplySerializer` (apps/tickets/serializers.py:538, `allow_blank=False`),
 * então esse envio sempre voltava 400. Entre apagar o gesto (botão só acende com
 * texto) e completá-lo, a tela completa: sem texto, o corpo vira a legenda dos
 * arquivos que a pessoa escolheu. É descrição do que está ali, não frase
 * inventada em nome de quem enviou — e a tela mostra a legenda ANTES do envio,
 * então ninguém publica o que não leu.
 *
 * Sem ponto final: o último caractere é um nome de arquivo, e um ponto colado
 * nele parece parte da extensão.
 */
function corpoParaEnviar(texto: string, anexos: File[]): string {
  const escrito = texto.trim()
  if (escrito) return escrito
  if (anexos.length === 0) return ''
  return `Segue em anexo: ${anexos.map((f) => f.name).join(', ')}`
}

function iniciaisDe(nome: string): string {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

interface Props {
  ticket: TicketDetalhe
  me: Me | undefined
  pedidoReabrir: number
}

/**
 * Compositor: responder ao cliente ou anotar para a equipe. É a superfície
 * mais usada do produto, então o desenho é um campo branco só, calmo, com tudo
 * que age sobre a mensagem DENTRO dele: o tipo (abas) e o destinatário em
 * cima, o texto, os anexos, e a barra embaixo — formatação, anexar, macro e o
 * envio.
 *
 * O que ele faz, e por quê:
 *  - formatação leve (negrito, itálico, listas, link; Ctrl+B/I/K), gravada
 *    como Markdown mínimo no próprio texto — a regra e o porquê de cada limite
 *    estão em `ui/textoFormatado.ts`; "Visualizar" mostra como vai ficar;
 *  - @menção em nota interna, com lista navegável por teclado; o campo mostra
 *    o NOME, e a troca pela marcação que o servidor lê acontece no envio
 *    (`mencoes.ts`, `paraMarcacao`). Em resposta ao cliente não há lista: lá
 *    a menção não existe (apps/tickets/services/mentions.py);
 *  - anexo por botão, arrastando para o campo ou colando um print (Ctrl+V),
 *    com miniatura das imagens e conferência ANTES de subir, contra o limite
 *    que o servidor publica (`conferirAnexos`);
 *  - o status "ao enviar" é um seletor visível, não um menu escondido atrás de
 *    uma seta (recognition over recall); "Fechado" abre AQUI os campos que o
 *    backend exige (datas da solução, D4);
 *  - "Agendar" usa o MESMO texto: antes havia um segundo campo só para
 *    agendar, e a pessoa escrevia a resposta no lugar errado;
 *  - o rascunho persiste por aba (`useTabs.atualizarRascunho`, só local);
 *  - erro de envio aparece junto do botão e o texto fica; Ctrl+Enter envia;
 *  - macro entra como menu com filtro e ainda grava os campos de triagem no
 *    servidor (apply-macro);
 *  - anexo sem texto é um envio válido: o corpo vira a legenda dos arquivos
 *    (`corpoParaEnviar`), visível antes de enviar;
 *  - "Reabrir…" no cabeçalho não reclassifica uma nota interna já escrita:
 *    pergunta.
 */
export function Compositor({ ticket, me, pedidoReabrir }: Props) {
  const idBase = useId()
  const { data: macros } = useMacros()
  // Limite de anexo é configuração do servidor (SystemConfig), não constante da
  // tela: a query é a mesma de Configurações (chave `cfg-sistema`), então cai no
  // cache já quente na maioria das vezes. Ainda não voltou, `limitesDeAnexo`
  // devolve null e a conferência local não recusa nada — ver o porquê lá.
  const { data: cfgSistema } = useSistemaCfg()
  const limites = limitesDeAnexo(cfgSistema)
  const { responder, aplicarMacro, agendarResposta } = useAcoesTicket(ticket.id)
  const rascunhoInicial = useTabs(
    (s) => s.tabs.find((t): t is AbaTicket => t.tipo === 'ticket' && t.ticketId === ticket.id)?.draft ?? '',
  )
  const atualizarRascunho = useTabs((s) => s.atualizarRascunho)

  const perms = me?.permissions ?? []
  const interno = me?.is_internal === true
  const podePublico = !interno || perms.includes('ticket.reply_public')
  const podeNota = interno && perms.includes('ticket.add_internal_note')
  const podeMacro = interno && perms.includes('macro.use')
  const podeAgendar = interno && perms.includes('ticket.reply_public')
  const fechado = ticket.status === 'closed'

  // Quem pode ser mencionado — só é pedido a quem escreve nota interna.
  const { data: alvosMencao } = useAlvosMencao(ticket.id, podeNota)
  const alvos: AlvoMencao[] = alvosMencao ?? []

  const [modoPublico, setPublico] = useState(true)
  // quem só pode anotar escreve em "nota interna", sem estado extra: deriva
  const publico = podePublico && modoPublico
  // Nota interna não leva assinatura (ninguém assina um bilhete para a
  // própria equipe) e quem não configurou uma não vê a opção — o servidor
  // segura as duas regras de qualquer forma.
  const podeAssinar = interno && publico && !!me?.signature_render
  const [texto, setTexto] = useState(rascunhoInicial)
  const [status, setStatus] = useState<StatusTicket>(() => statusInicialAoEnviar(ticket.status))
  // Mudanças vindas de fora (status do ticket por realtime; "Reabrir…" no
  // cabeçalho) ajustam o estado DURANTE o render, comparando com o valor
  // anterior — o padrão do React para "derivar de props", sem efeito+setState.
  const [statusVisto, setStatusVisto] = useState(ticket.status)
  if (statusVisto !== ticket.status) {
    setStatusVisto(ticket.status)
    setStatus(statusInicialAoEnviar(ticket.status))
  }
  const [reabrirVisto, setReabrirVisto] = useState(pedidoReabrir)
  // "Reabrir…" fica no CABEÇALHO: quem clica está olhando para lá, não para o
  // compositor. Trocar sozinho para público um texto que a pessoa escreveu em
  // "Nota interna" é decidir por ela quem lê o que ela escreveu — então o modo
  // só muda sozinho quando não há nada escrito. Havendo, a decisão é dela, e a
  // pergunta aparece no compositor (`perguntaReabrir`, abaixo).
  const [perguntaReabrir, setPerguntaReabrir] = useState(false)
  if (reabrirVisto !== pedidoReabrir) {
    setReabrirVisto(pedidoReabrir)
    setStatus('open')
    if (podePublico && !modoPublico && texto.trim()) setPerguntaReabrir(true)
    else setPublico(true)
  }
  const [anexos, setAnexos] = useState<File[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [menuMacro, setMenuMacro] = useState(false)
  // Filtro do menu de macro: texto digitado + índice virtualmente "ativo"
  // (o foco de verdade nunca sai do campo — mesmo padrão de
  // novo/BuscaPessoa.tsx, combobox com aria-activedescendant). Limpo toda
  // vez que o menu abre, no próprio botão que abre (abaixo).
  const [filtroMacro, setFiltroMacro] = useState('')
  const [macroAtiva, setMacroAtiva] = useState(0)
  const [tocouFechamento, setTocouFechamento] = useState(false)
  const [agoraMs, setAgoraMs] = useState(() => Date.now())
  const [inicioSolucao, setInicioSolucao] = useState(() => paraDatetimeLocal(ticket.created_at))
  const [fimSolucao, setFimSolucao] = useState(() => paraDatetimeLocal(new Date().toISOString()))
  const [notaFechamento, setNotaFechamento] = useState('')
  // Assinatura: ligada por padrão para quem tem uma configurada — é o
  // comportamento de cliente de e-mail, e é o que a pessoa quis dizer ao
  // cadastrá-la. Desmarcar vale só para esta mensagem.
  const [assinar, setAssinar] = useState(true)
  const [previa, setPrevia] = useState(false)
  // @menção: o `@` em aberto antes do cursor, a opção ativa, e o `@` que a
  // pessoa dispensou com Esc (a lista não volta sozinha para o mesmo `@`).
  const [mencao, setMencao] = useState<ConsultaMencao | null>(null)
  const [mencaoAtiva, setMencaoAtiva] = useState(0)
  const [mencaoDispensada, setMencaoDispensada] = useState<number | null>(null)
  // Quem foi escolhido na lista nesta sessão (nome → chave): desempata homônimos
  // na hora de trocar o nome pela marcação.
  const [escolhidos, setEscolhidos] = useState<ReadonlyMap<string, string>>(() => new Map())
  // Agendar: o painel pequeno ao lado do botão de enviar.
  const [agendando, setAgendando] = useState(false)
  const [quando, setQuando] = useState('')
  const [minimoAgenda, setMinimoAgenda] = useState('')

  const areaRef = useRef<HTMLTextAreaElement>(null)
  const inputAnexo = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const agendaRef = useRef<HTMLDivElement>(null)

  function adicionarAnexos(novos: File[]) {
    if (novos.length === 0) return
    const { aceitos, recusas } = conferirAnexos(anexos, novos, limites)
    if (aceitos.length > 0) setAnexos((a) => [...a, ...aceitos])
    // O que foi recusado some da tela junto com o motivo — não fica um arquivo
    // na lista que a pessoa acha que vai junto.
    setErro(recusas.length > 0 ? recusas.join(' ') : null)
  }

  const previas = usePreviasDeImagem(anexos)
  const soltar = useSoltarArquivos((arquivos) => adicionarAnexos(arquivos), podePublico || podeNota)

  // "Reabrir…" no cabeçalho: além de trocar o modo (acima), leva o foco ao texto
  useEffect(() => {
    if (pedidoReabrir > 0) areaRef.current?.focus()
  }, [pedidoReabrir])

  // rascunho por aba — local, com folga para não gravar a cada tecla
  useEffect(() => {
    const h = setTimeout(() => atualizarRascunho(ticket.id, texto), 300)
    return () => clearTimeout(h)
  }, [texto, ticket.id, atualizarRascunho])

  // textarea cresce com o conteúdo (até o limite do CSS)
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [texto, publico, previa])

  // menu de macro e painel de agendar fecham ao clicar fora / Esc
  useEffect(() => {
    if (!menuMacro && !agendando) return
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (menuMacro && !menuRef.current?.contains(alvo)) setMenuMacro(false)
      if (agendando && !agendaRef.current?.contains(alvo)) setAgendando(false)
    }
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuMacro(false)
        setAgendando(false)
      }
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [menuMacro, agendando])

  // aviso (macro aplicada etc.) some sozinho
  useEffect(() => {
    if (!aviso) return
    const h = setTimeout(() => setAviso(null), 5000)
    return () => clearTimeout(h)
  }, [aviso])

  // Colaboração (colaboracao/): avisa os colegas que estou escrevendo e
  // recebe os atalhos `r`/`n`. Única ligação do compositor com aquilo.
  useCompositorColaborativo(ticket.id, {
    texto,
    publico,
    aoPedirModo: (paraPublico) => {
      setPublico(paraPublico)
      setPerguntaReabrir(false)
      areaRef.current?.focus()
    },
  })

  if (!podePublico && !podeNota) {
    return (
      <div className="compositor compositor--bloqueado" role="note">
        <i className="ti ti-lock" aria-hidden="true" />
        Seu papel não permite escrever neste ticket.
      </div>
    )
  }

  const vaiFechar = publico && interno && status === 'closed'
  const errosFechamento = vaiFechar
    ? validarFechamento({
        criadoEm: ticket.created_at,
        inicio: inicioSolucao,
        fim: fimSolucao,
        agoraMs,
      })
    : {}
  const fechamentoInvalido = Boolean(errosFechamento.inicio || errosFechamento.fim)
  const temConteudo = texto.trim().length > 0 || anexos.length > 0
  const podeEnviar = temConteudo && !responder.isPending
  // Anexo sem texto continua acendendo o botão — e agora chega ao servidor com
  // corpo, que é o que faltava (ver `corpoParaEnviar`).
  const corpoDaMensagem = corpoParaEnviar(texto, anexos)
  const soAnexo = !texto.trim() && anexos.length > 0
  // Sem configuração carregada não há teto conhecido: não bloqueia e não
  // anuncia número nenhum, em vez de anunciar um chutado.
  const anexosNoLimite = limites != null && anexos.length >= limites.maxArquivos

  // Nota interna: `@Nome` vira a marcação que o servidor lê. Resposta ao
  // cliente vai como está — lá a marcação seria texto morto na tela do cliente.
  const corpoFinal = (corpo: string) =>
    publico ? corpo : paraMarcacao(corpo, alvos, escolhidos)

  // ---- @menção -----------------------------------------------------------
  const mencaoLigada = !publico && podeNota && alvos.length > 0 && !previa
  const alvosFiltrados = mencao ? filtrarAlvos(alvos, mencao.consulta) : []
  // Sem resultado e com espaço na consulta, a pessoa já está escrevendo a
  // frase ("@ana amanhã cedo"): a lista some em vez de dizer "ninguém".
  const listaMencaoAberta =
    mencaoLigada &&
    mencao != null &&
    mencao.inicio !== mencaoDispensada &&
    (alvosFiltrados.length > 0 || !/\s/.test(mencao.consulta))
  const mencaoAtivaValida = Math.min(mencaoAtiva, Math.max(alvosFiltrados.length - 1, 0))
  const idListaMencao = `${idBase}-mencoes`
  const idOpcaoMencao = (a: AlvoMencao) => `${idListaMencao}-${a.type}-${a.id}`

  function atualizarMencao(valor: string, cursor: number | null) {
    if (!mencaoLigada || cursor == null) {
      if (mencao) setMencao(null)
      return
    }
    const nova = consultaDeMencao(valor, cursor)
    if (nova?.inicio !== mencao?.inicio || nova?.consulta !== mencao?.consulta) {
      setMencao(nova)
      setMencaoAtiva(0)
    }
  }

  function escolherMencao(alvo: AlvoMencao) {
    const campo = areaRef.current
    if (!campo || !mencao) return
    setEscolhidos((m) => new Map(m).set(alvo.name, chaveDoAlvo(alvo)))
    aplicar(inserirMencao(campo.value, mencao, campo.selectionEnd, alvo))
    setMencao(null)
  }

  /** Botão "@": põe um `@` no cursor (com espaço antes, se colado numa
   *  palavra) — a lista abre sozinha a partir dele. */
  function comecarMencao() {
    const campo = areaRef.current
    if (!campo) return
    const { selectionStart: a, selectionEnd: b, value } = campo
    const antes = a > 0 && !/\s/.test(value[a - 1]) ? ' ' : ''
    const trecho = `${antes}@`
    const fim = a + trecho.length
    setMencaoDispensada(null)
    aplicar({ inicio: a, fim: b, trecho, selecao: [fim, fim] })
    setMencao({ inicio: fim - 1, consulta: '' })
  }

  // ---- edição do texto ----------------------------------------------------
  function aplicar(edicao: Edicao) {
    const campo = areaRef.current
    if (!campo) return
    aplicarNoCampo(campo, edicao, setTexto)
  }

  function formatar(tipo: Formato) {
    const campo = areaRef.current
    if (!campo || previa) return
    const { selectionStart: a, selectionEnd: b, value } = campo
    aplicar(
      tipo === 'negrito'
        ? envolver(value, a, b, '**')
        : tipo === 'italico'
          ? envolver(value, a, b, '_')
          : tipo === 'lista'
            ? alternarLista(value, a, b, 'marcada')
            : tipo === 'numerada'
              ? alternarLista(value, a, b, 'numerada')
              : inserirLink(value, a, b),
    )
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Com a lista de menção aberta, setas/Enter/Tab/Esc são dela.
    if (listaMencaoAberta && mencao) {
      if (e.key === 'ArrowDown' && alvosFiltrados.length > 0) {
        e.preventDefault()
        setMencaoAtiva((i) => Math.min(i + 1, alvosFiltrados.length - 1))
        return
      }
      if (e.key === 'ArrowUp' && alvosFiltrados.length > 0) {
        e.preventDefault()
        setMencaoAtiva((i) => Math.max(i - 1, 0))
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const alvo = alvosFiltrados[mencaoAtivaValida]
        if (alvo) {
          e.preventDefault()
          escolherMencao(alvo)
          return
        }
      }
      if (e.key === 'Escape') {
        // só fecha a lista: o Esc não vaza para o documento (que fecharia
        // outras coisas abertas, como o menu de macro)
        e.preventDefault()
        e.stopPropagation()
        setMencaoDispensada(mencao.inicio)
        return
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      enviar()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      const campo = e.currentTarget
      const continuacao = continuarLista(campo.value, campo.selectionStart, campo.selectionEnd)
      if (continuacao) {
        e.preventDefault()
        aplicar(continuacao)
      }
      return
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const tecla = e.key.toLowerCase()
      const formato: Formato | null =
        tecla === 'b' ? 'negrito' : tecla === 'i' ? 'italico' : tecla === 'k' ? 'link' : null
      if (formato) {
        // stopPropagation: Ctrl+K no resto da tela abre a busca global
        // (shell/BuscaComando.tsx); aqui dentro do texto ele é "link"
        e.preventDefault()
        e.stopPropagation()
        formatar(formato)
      }
    }
  }

  function aoColar(e: ClipboardEvent<HTMLTextAreaElement>) {
    const dados = e.clipboardData
    if (!dados) return
    // Texto junto na área de transferência (célula de planilha, trecho do
    // Word) é colagem de TEXTO — o "print" que esses programas mandam de
    // brinde não é o que a pessoa quis anexar. Só o print puro vira anexo.
    if (dados.getData?.('text/plain')) return
    const imagens = imagensColadas(dados.items ?? null, new Date())
    if (imagens.length === 0) return
    e.preventDefault()
    adicionarAnexos(imagens)
  }

  function trocarModo(paraPublico: boolean) {
    setPublico(paraPublico)
    setPerguntaReabrir(false)
    setErro(null)
    setMencao(null)
    setAgendando(false)
    setPrevia(false)
    areaRef.current?.focus()
  }

  function enviar() {
    if (!podeEnviar) return
    setErro(null)
    // Mesma conferência da escolha, agora sobre o lote inteiro — é o que
    // `validar_uploads` faz no servidor. Cobre o caso do limite ter chegado
    // depois da escolha (a configuração é uma query; até ela voltar vale o
    // padrão) e o de o limite ter mudado com a aba aberta.
    const { recusas } = conferirAnexos([], anexos, limites)
    if (recusas.length > 0) {
      setErro(`${recusas.join(' ')} Tire o arquivo da lista para enviar o resto.`)
      return
    }
    if (vaiFechar) {
      setTocouFechamento(true)
      // "agora" novo só no momento de validar — não a cada tecla
      setAgoraMs(Date.now())
      if (fechamentoInvalido) return
    }
    responder.mutate(
      {
        body: corpoFinal(corpoDaMensagem),
        is_public: publico,
        // a assinatura NÃO entra no corpo: o servidor a desenha abaixo dele,
        // a partir do perfil (apps/accounts/assinatura.py)
        with_signature: assinar && podeAssinar,
        // resposta pública de agente exige status; nota interna não manda status
        ...(publico && interno ? { new_status: status } : {}),
        ...(vaiFechar
          ? {
              resolution_started_at: new Date(inicioSolucao).toISOString(),
              resolution_ended_at: new Date(fimSolucao).toISOString(),
              close_note: notaFechamento.trim(),
            }
          : {}),
        ...(anexos.length > 0 ? { files: anexos } : {}),
      },
      {
        onSuccess: () => {
          setTexto('')
          setAnexos([])
          setNotaFechamento('')
          setTocouFechamento(false)
          setPrevia(false)
          setEscolhidos(new Map())
          atualizarRascunho(ticket.id, '')
        },
        onError: (e) => {
          setErro(
            `${mensagemDeErro(e, 'Não foi possível enviar.')} Seu texto e os anexos continuam aqui.`,
          )
        },
      },
    )
  }

  // ---- agendar ------------------------------------------------------------
  const statusAgendavel = STATUS_AGENDAVEIS.includes(status)
  const motivoSemAgenda = !texto.trim()
    ? 'Escreva a resposta antes de agendar.'
    : anexos.length > 0
      ? 'Resposta agendada não leva anexo: envie agora ou tire os anexos.'
      : !statusAgendavel
        ? 'Fechar não pode ser agendado. Escolha “Aberto” ou “Aguardando retorno do cliente”.'
        : null
  const podeConfirmarAgenda = !motivoSemAgenda && quando.length > 0 && !agendarResposta.isPending

  function abrirAgenda() {
    // piso carimbado ao ABRIR, não a cada render: ler o relógio no render é
    // impuro e faria o mínimo andar sozinho enquanto a pessoa escolhe
    setMinimoAgenda(paraDatetimeLocal(new Date(Date.now() + 60_000).toISOString()))
    setAgendando((v) => !v)
  }

  function agendar() {
    if (!podeConfirmarAgenda) return
    setErro(null)
    agendarResposta.mutate(
      {
        body: texto.trim(),
        is_public: true,
        new_status: status,
        with_signature: assinar && podeAssinar,
        scheduled_at: new Date(quando).toISOString(),
      },
      {
        onSuccess: () => {
          setAviso(`Resposta agendada para ${formatarDataHora(new Date(quando).toISOString())}.`)
          setTexto('')
          setQuando('')
          setAgendando(false)
          atualizarRascunho(ticket.id, '')
        },
        onError: (e) =>
          setErro(`${mensagemDeErro(e, 'Não foi possível agendar.')} Seu texto continua aqui.`),
      },
    )
  }

  // ---- macro --------------------------------------------------------------
  function usarMacro(m: Macro) {
    setMenuMacro(false)
    setFiltroMacro('')
    setMacroAtiva(0)
    const corpo = interpolarMacro(m.body ?? '', {
      solicitante: ticket.requester_display,
      empresa: ticket.company_name,
      referencia: ticket.reference,
    })
    if (corpo) setTexto((t) => (t.trim() ? `${t}\n${corpo}` : corpo))
    const pendentes = marcadoresPendentes(corpo)
    const temTriagem = Boolean(
      m.category || m.priority || m.assignee || (m.tags && m.tags.length > 0),
    )
    if (temTriagem) {
      aplicarMacro.mutate(m.id, {
        onError: (e) =>
          setErro(
            `${mensagemDeErro(e, 'A macro não pôde atualizar os campos do ticket.')} O texto foi inserido mesmo assim.`,
          ),
      })
    }
    setAviso(
      pendentes.length
        ? `Macro “${m.name}” aplicada. Revise ${pendentes.join(', ')} no texto.`
        : `Macro “${m.name}” aplicada${temTriagem ? ' (texto e campos de triagem)' : ''}.`,
    )
    setPrevia(false)
    areaRef.current?.focus()
  }

  const idTexto = `${idBase}-texto`
  const idStatus = `${idBase}-status`
  const idErro = `${idBase}-erro`
  const idDica = `${idBase}-dica`
  const idMacroLista = `${idBase}-macro-lista`
  const idOpcaoMacro = (m: Macro) => `${idMacroLista}-${m.id}`
  const idQuando = `${idBase}-quando`

  // Filtra por nome E corpo — achar pelo texto que a macro escreve é tão
  // comum quanto achar pelo nome dela. Índice ativo é CLAMPADO aqui, não
  // corrigido num efeito: apagar/filtrar pode encolher a lista para menos
  // que o índice que estava selecionado (mesma técnica de roving tabindex
  // usada em resolv/shell/ListaTrabalho.tsx — derivar durante o render, não
  // sincronizar depois).
  const macrosFiltradas = (macros ?? []).filter((m) =>
    normalizar(`${m.name} ${m.body ?? ''}`).includes(normalizar(filtroMacro)),
  )
  const macroAtivaValida = Math.min(macroAtiva, Math.max(macrosFiltradas.length - 1, 0))
  const rotuloBotao = rotuloEnviar({
    publico,
    statusAtual: ticket.status,
    statusEscolhido: status,
    enviando: responder.isPending,
  })

  // Abas no padrão WAI-ARIA: só a ativa entra no Tab; setas trocam.
  const abas = [podePublico && 'publico', podeNota && 'nota'].filter(Boolean) as ('publico' | 'nota')[]
  function aoTeclarAbas(e: KeyboardEvent<HTMLDivElement>) {
    if (abas.length < 2 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const paraPublico = e.key === 'Home' ? true : e.key === 'End' ? false : !publico
    trocarModo(paraPublico)
    const alvo = e.currentTarget.querySelector<HTMLElement>(
      `[data-aba="${paraPublico ? 'publico' : 'nota'}"]`,
    )
    alvo?.focus()
  }

  const mencoesDaPrevia = alvos.map((a) => ({ key: chaveDoAlvo(a), name: a.name }))

  return (
    <div
      className={
        'compositor' +
        (publico ? '' : ' compositor--interna') +
        (soltar.arrastando ? ' compositor--soltar' : '')
      }
    >
      {fechado && (
        <p className="compositor__aviso-fechado">
          <i className="ti ti-circle-check" aria-hidden="true" />
          Ticket fechado{ticket.closed_at ? ` em ${formatarDataHora(ticket.closed_at)}` : ''}
          {ticket.auto_closed ? ' (automaticamente, por falta de resposta)' : ''}.{' '}
          {publico
            ? 'Uma resposta pública reabre o ticket.'
            : 'Uma nota interna não reabre o ticket.'}
        </p>
      )}

      {perguntaReabrir && (
        <div className="compositor__pergunta" role="alert">
          <i className="ti ti-help-circle" aria-hidden="true" />
          <div>
            <p>
              Reabrir é responder ao cliente, mas você está escrevendo uma nota interna. O texto
              continua interno até você decidir.
            </p>
            <div className="compositor__pergunta-acoes">
              <button
                type="button"
                className="compositor__pergunta-botao compositor__pergunta-botao--primario"
                onClick={() => {
                  setPublico(true)
                  setPerguntaReabrir(false)
                  areaRef.current?.focus()
                }}
              >
                Passar para resposta ao cliente
              </button>
              <button
                type="button"
                className="compositor__pergunta-botao"
                onClick={() => {
                  setPerguntaReabrir(false)
                  areaRef.current?.focus()
                }}
              >
                Manter como nota interna
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="compositor__superficie" {...soltar.props}>
        <div className="compositor__cabeca">
          <div
            className="compositor__abas"
            role="tablist"
            aria-label="Tipo de mensagem"
            onKeyDown={aoTeclarAbas}
          >
            {podePublico && (
              <button
                type="button"
                role="tab"
                data-aba="publico"
                aria-selected={publico}
                aria-controls={idTexto}
                tabIndex={publico ? 0 : -1}
                className={'compositor__aba' + (publico ? ' compositor__aba--ativa' : '')}
                onClick={() => trocarModo(true)}
              >
                <i className="ti ti-arrow-back-up" aria-hidden="true" /> Responder ao cliente
              </button>
            )}
            {podeNota && (
              <button
                type="button"
                role="tab"
                data-aba="nota"
                aria-selected={!publico}
                aria-controls={idTexto}
                tabIndex={!publico ? 0 : -1}
                className={
                  'compositor__aba compositor__aba--nota' +
                  (!publico ? ' compositor__aba--ativa' : '')
                }
                onClick={() => trocarModo(false)}
              >
                <i className="ti ti-lock" aria-hidden="true" /> Nota interna
              </button>
            )}
          </div>
          <span className="compositor__destino">
            {publico ? (
              <>
                <span className="compositor__destino-rotulo">Para</span>{' '}
                <strong>{ticket.requester_display}</strong>
                {ticket.requester?.email ? (
                  <span className="compositor__email"> · {ticket.requester.email}</span>
                ) : null}
              </>
            ) : (
              <>
                <i className="ti ti-eye-off" aria-hidden="true" /> Só a equipe vê
                {podeNota && alvos.length > 0 ? (
                  <span className="compositor__email"> · @ menciona alguém</span>
                ) : null}
              </>
            )}
          </span>
        </div>

        <div className="compositor__campo-texto">
          {previa ? (
            <div
              id={idTexto}
              className="compositor__previa"
              role="region"
              aria-label="Prévia da mensagem"
              tabIndex={0}
            >
              {texto.trim() ? (
                <TextoFormatado
                  texto={corpoFinal(texto.trim())}
                  mencoes={publico ? undefined : mencoesDaPrevia}
                />
              ) : (
                <p className="compositor__previa-vazia">Nada escrito ainda.</p>
              )}
            </div>
          ) : (
            <textarea
              ref={areaRef}
              id={idTexto}
              className="compositor__texto"
              placeholder={
                publico
                  ? 'Escreva a resposta ao cliente…'
                  : 'Anote para a equipe. O cliente nunca vê isto…'
              }
              aria-label={publico ? 'Resposta ao cliente' : 'Nota interna'}
              aria-describedby={[erro ? idErro : null, idDica].filter(Boolean).join(' ')}
              aria-autocomplete={mencaoLigada ? 'list' : undefined}
              aria-controls={listaMencaoAberta ? idListaMencao : undefined}
              aria-activedescendant={
                listaMencaoAberta && alvosFiltrados[mencaoAtivaValida]
                  ? idOpcaoMencao(alvosFiltrados[mencaoAtivaValida])
                  : undefined
              }
              value={texto}
              rows={3}
              onChange={(e) => {
                setTexto(e.target.value)
                atualizarMencao(e.target.value, e.target.selectionEnd)
              }}
              onSelect={(e) =>
                atualizarMencao(e.currentTarget.value, e.currentTarget.selectionEnd)
              }
              onBlur={() => setMencao(null)}
              onKeyDown={aoTeclar}
              onPaste={aoColar}
            />
          )}

          {listaMencaoAberta && (
            <div className="compositor__mencoes">
              <ul
                id={idListaMencao}
                role="listbox"
                aria-label="Mencionar"
                className="compositor__mencoes-lista"
              >
                {alvosFiltrados.length === 0 ? (
                  <li className="compositor__mencoes-vazio" role="presentation">
                    Ninguém com “{mencao?.consulta}”.
                  </li>
                ) : (
                  alvosFiltrados.map((a, i) => (
                    <li
                      key={`${a.type}-${a.id}`}
                      id={idOpcaoMencao(a)}
                      role="option"
                      aria-selected={i === mencaoAtivaValida}
                      className={
                        'compositor__mencao' +
                        (i === mencaoAtivaValida ? ' compositor__mencao--ativa' : '')
                      }
                      // mousedown, não click: o clique tiraria o foco do texto
                      // (e o blur fecharia a lista) antes de escolher
                      onMouseDown={(e) => {
                        e.preventDefault()
                        escolherMencao(a)
                      }}
                      onMouseEnter={() => setMencaoAtiva(i)}
                    >
                      <span className="compositor__mencao-avatar" aria-hidden="true">
                        {a.type === 'team' ? <i className="ti ti-users" /> : iniciaisDe(a.name)}
                      </span>
                      <span className="compositor__mencao-nome">{a.name}</span>
                      <span className="compositor__mencao-grupo">
                        {ROTULO_GRUPO_MENCAO[a.group ?? ''] ?? a.email}
                      </span>
                    </li>
                  ))
                )}
              </ul>
              <p className="compositor__mencoes-dica" aria-hidden="true">
                ↑↓ para escolher · Enter insere · Esc fecha
              </p>
            </div>
          )}
          {/* leitor de tela ouve quantas opções há, sem precisar sair do texto */}
          <span className="compositor__so-leitor" role="status">
            {listaMencaoAberta
              ? alvosFiltrados.length === 1
                ? '1 pessoa para mencionar'
                : `${alvosFiltrados.length} opções para mencionar`
              : ''}
          </span>
        </div>

        {anexos.length > 0 && (
          <ul className="compositor__anexos" aria-label="Anexos a enviar">
            {anexos.map((f, i) => {
              const miniatura = previas.get(f)
              return (
                <li
                  key={`${f.name}-${f.size}-${i}`}
                  className={'compositor__anexo' + (miniatura ? ' compositor__anexo--imagem' : '')}
                >
                  {miniatura ? (
                    <img className="compositor__anexo-miniatura" src={miniatura} alt="" />
                  ) : (
                    <i className={classeIconeDoArquivo(f.type, f.name)} aria-hidden="true" />
                  )}
                  <span className="compositor__anexo-texto">
                    <span className="compositor__anexo-nome">{f.name}</span>
                    <span className="compositor__anexo-tam">{tamanhoArquivo(f.size)}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remover ${f.name}`}
                    title="Remover"
                    onClick={() => {
                      setAnexos((a) => a.filter((_, j) => j !== i))
                      setErro(null)
                    }}
                  >
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {soAnexo && (
          <p className="compositor__corpo-padrao">
            <i className="ti ti-corner-down-right" aria-hidden="true" />
            Sem nada escrito, a mensagem vai com a legenda “{corpoDaMensagem}”.
          </p>
        )}

        {podeAssinar && assinar && (
          // a prévia evita a surpresa de descobrir o rodapé depois de enviado;
          // o HTML já vem higienizado do servidor (`signature_render`)
          <div
            className="compositor__assinatura-previa assinatura-mensagem"
            dangerouslySetInnerHTML={{ __html: me?.signature_render ?? '' }}
          />
        )}

        {vaiFechar && (
          <fieldset className="compositor__fechamento">
            <legend>
              Fechamento: registre o período real da solução
              <span className="compositor__fechamento-dica">
                (a resposta e o fechamento vão juntos)
              </span>
            </legend>
            <div className="compositor__fechamento-campos">
              <div className="compositor__campo">
                <label htmlFor={`${idBase}-inicio`}>Início da solução</label>
                <input
                  id={`${idBase}-inicio`}
                  type="datetime-local"
                  value={inicioSolucao}
                  onChange={(e) => setInicioSolucao(e.target.value)}
                  aria-invalid={tocouFechamento && !!errosFechamento.inicio}
                />
                {tocouFechamento && errosFechamento.inicio && (
                  <span className="compositor__campo-erro">{errosFechamento.inicio}</span>
                )}
              </div>
              <div className="compositor__campo">
                <label htmlFor={`${idBase}-fim`}>Fim da solução</label>
                <input
                  id={`${idBase}-fim`}
                  type="datetime-local"
                  value={fimSolucao}
                  onChange={(e) => setFimSolucao(e.target.value)}
                  aria-invalid={tocouFechamento && !!errosFechamento.fim}
                />
                {tocouFechamento && errosFechamento.fim && (
                  <span className="compositor__campo-erro">{errosFechamento.fim}</span>
                )}
              </div>
              <div className="compositor__campo compositor__campo--largo">
                <label htmlFor={`${idBase}-nota`}>
                  Justificativa{' '}
                  <span className="compositor__opcional">(opcional, vai para o histórico)</span>
                </label>
                <input
                  id={`${idBase}-nota`}
                  type="text"
                  maxLength={200}
                  value={notaFechamento}
                  placeholder="Ex.: correção aplicada e validada com o cliente"
                  onChange={(e) => setNotaFechamento(e.target.value)}
                />
              </div>
            </div>
          </fieldset>
        )}

        {aviso && (
          <p className="compositor__aviso" role="status">
            <i className="ti ti-bolt" aria-hidden="true" /> {aviso}
          </p>
        )}
        {erro && (
          <p id={idErro} className="compositor__erro" role="alert">
            <i className="ti ti-alert-circle" aria-hidden="true" /> {erro}
          </p>
        )}

        <div className="compositor__rodape">
          <div className="compositor__ferramentas" role="toolbar" aria-label="Formatação e anexos">
            {FORMATOS.map((f) => {
              const dica = f.atalho ? `${f.rotulo} (${TECLA}+${f.atalho})` : f.rotulo
              return (
                <button
                  key={f.id}
                  type="button"
                  className="compositor__ferramenta compositor__ferramenta--icone"
                  aria-label={f.rotulo}
                  aria-keyshortcuts={f.atalho ? `Control+${f.atalho} Meta+${f.atalho}` : undefined}
                  data-dica={dica}
                  disabled={previa}
                  // o clique não pode tirar o foco (nem a seleção) do texto
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => formatar(f.id)}
                >
                  <i className={f.icone} aria-hidden="true" />
                </button>
              )
            })}
            <span className="compositor__separador" aria-hidden="true" />
            {!publico && podeNota && alvos.length > 0 && (
              <button
                type="button"
                className="compositor__ferramenta compositor__ferramenta--icone"
                aria-label="Mencionar alguém"
                data-dica="Mencionar (@)"
                disabled={previa}
                onMouseDown={(e) => e.preventDefault()}
                onClick={comecarMencao}
              >
                <i className="ti ti-at" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="compositor__ferramenta"
              onClick={() => inputAnexo.current?.click()}
              disabled={anexosNoLimite}
              data-dica={
                anexosNoLimite && limites
                  ? `Já são ${limites.maxArquivos}, o máximo por mensagem`
                  : 'Anexar arquivo (ou arraste, ou cole um print)'
              }
            >
              <i className="ti ti-paperclip" aria-hidden="true" />
              <span className="compositor__ferramenta-rotulo">Anexar</span>
            </button>
            <input
              ref={inputAnexo}
              type="file"
              multiple
              hidden
              accept={TIPOS_ACEITOS}
              aria-label="Escolher arquivos para anexar"
              onChange={(e) => {
                adicionarAnexos(Array.from(e.target.files ?? []))
                e.target.value = '' // permite re-selecionar o mesmo arquivo
              }}
            />

            {podeMacro && (macros?.length ?? 0) > 0 && (
              <div className="compositor__macro" ref={menuRef}>
                <button
                  type="button"
                  className={
                    'compositor__ferramenta' + (menuMacro ? ' compositor__ferramenta--ativa' : '')
                  }
                  aria-label="Aplicar macro"
                  aria-haspopup="listbox"
                  aria-expanded={menuMacro}
                  data-dica={menuMacro ? undefined : 'Aplicar macro (texto pronto e triagem)'}
                  onClick={() => {
                    // Abrir sempre começa sem filtro — reabrir com o texto da
                    // última vez leria como "a macro que eu busquei antes
                    // sumiu", já que a lista mostraria só o resultado antigo.
                    if (!menuMacro) {
                      setFiltroMacro('')
                      setMacroAtiva(0)
                    }
                    setMenuMacro((v) => !v)
                  }}
                >
                  <i className="ti ti-bolt" aria-hidden="true" />
                  <span className="compositor__ferramenta-rotulo">Macro</span>
                </button>
                {menuMacro && (
                  <div className="compositor__macro-painel">
                    {/* Fora da área que rola (compositor__macro-menu, abaixo):
                        um campo fixo que rola junto seria escondido pela
                        própria lista que ele filtra. O foco fica AQUI o tempo
                        todo — as opções não são tabuláveis, mesmo padrão de
                        novo/BuscaPessoa.tsx (combobox com seleção virtual via
                        aria-activedescendant, não uma navegação por Tab entre
                        itens de um menu). */}
                    <input
                      type="text"
                      autoFocus
                      className="compositor__macro-filtro"
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
                        // Escape: sem handler próprio — o keydown de documento
                        // (useEffect acima) já fecha o menu.
                      }}
                    />
                    <ul
                      id={idMacroLista}
                      className="compositor__macro-menu"
                      role="listbox"
                      aria-label="Macros"
                    >
                      {macrosFiltradas.length === 0 ? (
                        <li className="compositor__macro-vazio" role="presentation">
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
                              'compositor__macro-opcao' +
                              (i === macroAtivaValida ? ' compositor__macro-opcao--ativa' : '')
                            }
                            onMouseEnter={() => setMacroAtiva(i)}
                            onClick={() => usarMacro(m)}
                          >
                            <span className="compositor__macro-nome">{m.name}</span>
                            {m.body && (
                              <span className="compositor__macro-previa">
                                {m.body.split('\n')[0]}
                              </span>
                            )}
                            {(m.category_name || m.priority || m.assignee_name) && (
                              <span className="compositor__macro-triagem">
                                {[
                                  m.category_name && `categoria → ${m.category_name}`,
                                  m.priority &&
                                    `prioridade → ${ROTULO_PRIORIDADE[m.priority] ?? m.priority}`,
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

            <button
              type="button"
              className={
                'compositor__ferramenta compositor__ferramenta--icone' +
                (previa ? ' compositor__ferramenta--ativa' : '')
              }
              aria-label="Visualizar"
              aria-pressed={previa}
              data-dica={previa ? 'Voltar a editar' : 'Visualizar como vai ficar'}
              onClick={() => {
                setPrevia((v) => !v)
                setMencao(null)
                // voltando a editar, o foco volta para onde se escreve
                if (previa) requestAnimationFrame(() => areaRef.current?.focus())
              }}
            >
              <i className={previa ? 'ti ti-pencil' : 'ti ti-eye'} aria-hidden="true" />
            </button>
          </div>

          <div className="compositor__enviar">
            {publico && interno && (
              <span className="compositor__status">
                <label htmlFor={idStatus}>Ao enviar, deixar</label>
                <span className="compositor__status-select">
                  <select
                    id={idStatus}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as StatusTicket)}
                    // Select nativo focado + roda do mouse por cima = o
                    // navegador troca a opção selecionada em vez de rolar a
                    // página (Chrome e Firefox, sem precisar clicar de novo —
                    // some dar :focus uma vez já bastou). Aqui é o pior lugar
                    // possível pra isso: rolar até o fim da conversa pra
                    // responder passa o cursor bem em cima deste combo, e
                    // "Fechado" é a última opção da lista — um scroll comum
                    // pousa exatamente nela, o botão vira verde e a resposta
                    // fecharia o ticket sem ninguém ter escolhido isso.
                    // Devolve o evento pro scroll normal da página assim que
                    // ele chega, antes do navegador aplicar a troca.
                    onWheel={(e) => e.currentTarget.blur()}
                  >
                    {STATUS_AO_ENVIAR.map((s) => (
                      <option key={s} value={s}>
                        {ROTULO_AO_ENVIAR[s] ?? ROTULO_STATUS[s]}
                      </option>
                    ))}
                  </select>
                  <i className="ti ti-chevron-down" aria-hidden="true" />
                </span>
              </span>
            )}

            {publico && podeAgendar && (
              <div className="compositor__agenda" ref={agendaRef}>
                <button
                  type="button"
                  className={
                    'compositor__ferramenta compositor__ferramenta--icone compositor__agenda-botao' +
                    (agendando ? ' compositor__ferramenta--ativa' : '')
                  }
                  aria-label="Agendar envio"
                  aria-haspopup="dialog"
                  aria-expanded={agendando}
                  data-dica={agendando ? undefined : 'Agendar envio'}
                  onClick={abrirAgenda}
                >
                  <i className="ti ti-calendar-time" aria-hidden="true" />
                </button>
                {agendando && (
                  <div className="compositor__agenda-painel" role="dialog" aria-label="Agendar envio">
                    <label className="compositor__agenda-rotulo" htmlFor={idQuando}>
                      Enviar em
                    </label>
                    <input
                      id={idQuando}
                      type="datetime-local"
                      autoFocus
                      value={quando}
                      min={minimoAgenda}
                      onChange={(e) => setQuando(e.target.value)}
                    />
                    <p className="compositor__agenda-dica">
                      {motivoSemAgenda ??
                        `Sai sozinha na hora marcada, com este texto, e o ticket fica “${ROTULO_AO_ENVIAR[status]}”.`}
                    </p>
                    <div className="compositor__agenda-acoes">
                      <button
                        type="button"
                        className="compositor__agenda-cancelar"
                        onClick={() => setAgendando(false)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="compositor__agenda-confirmar"
                        disabled={!podeConfirmarAgenda}
                        onClick={agendar}
                      >
                        {agendarResposta.isPending ? 'Agendando…' : 'Agendar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className={'compositor__botao' + (vaiFechar ? ' compositor__botao--fechar' : '')}
              disabled={!podeEnviar}
              onClick={enviar}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              // O convite do title ("ou anexe um arquivo") ficou: agora ele é
              // verdade — anexo sem texto envia, com a legenda de `corpoParaEnviar`.
              title={
                temConteudo
                  ? `${TECLA}+Enter envia`
                  : 'Escreva algo ou anexe um arquivo para enviar'
              }
            >
              {rotuloBotao}
              <kbd aria-hidden="true">{EH_MAC ? '⌘↵' : 'Ctrl ↵'}</kbd>
            </button>
          </div>
        </div>

        {soltar.arrastando && (
          <div className="compositor__soltar" aria-hidden="true">
            <i className="ti ti-upload" />
            <span>Solte para anexar</span>
          </div>
        )}
      </div>

      <div className="compositor__pe">
        {podeAssinar ? (
          <label className="compositor__assinatura-toggle">
            <input
              type="checkbox"
              checked={assinar}
              onChange={(e) => setAssinar(e.target.checked)}
            />
            Incluir minha assinatura
          </label>
        ) : (
          <span />
        )}
        {/* O limite fica visível ANTES de escolher: era a tela de abertura
            prometendo 20 MB que fazia a pessoa esperar o upload para descobrir
            que o teto é outro. */}
        <span id={idDica} className="compositor__dica-anexo">
          <span className="compositor__dica-arrastar">Arraste ou cole arquivos no campo.</span>
          {limites && (
            <>
              {' '}
              Até {limites.maxMb} MB por arquivo · {limites.maxArquivos} arquivos ·{' '}
              {limites.maxMbPorMensagem} MB no total
            </>
          )}
        </span>
      </div>
    </div>
  )
}
