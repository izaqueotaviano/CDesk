import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type Paginado } from '@/api/client'
import { MINIMO_PARA_BUSCAR, useBuscaGlobal, type SolicitanteEncontrado } from '@/api/busca'
import { useMe } from '@/api/queries/useMe'
import { useSistemaCfg } from '@/cvz/configuracoes/dados'
import { identidadeDe } from '@/ui/identidade'
import {
  useAbrirTicket,
  useAgentes,
  useCategorias,
  useEmpresasOpcoes,
  useEquipes,
  useEstimativaResposta,
  useEtiquetas,
  useServicos,
  type UsuarioDiretorio,
} from '@/cvz/tickets/dados'
import { conferirAnexos, limitesDeAnexo } from '../anexos'
import { COR_PRIORIDADE, ROTULO_PRIORIDADE } from '../format'
import type { Prioridade } from '../tipos'
import { useMacros } from '../detalhe/dados'
import { Campo } from '../detalhe/PainelPropriedades'
import {
  iniciais,
  interpolarMacro,
  marcadoresPendentes,
  mensagemDeErro,
  tamanhoArquivo,
} from '../detalhe/linhaDoTempo'
import type { Macro } from '../detalhe/tiposDetalhe'
import { BuscaPessoa } from './BuscaPessoa'
import { estaSujo, lerRascunho, limparRascunho, useGravarRascunho, type Rascunho } from './rascunho'
// A tela é "o detalhe antes de o ticket existir": mesmas colunas, mesmos
// controles (.props, .compositor, .ticket-cab) — importa a folha do detalhe
// e só acrescenta o que é próprio da abertura em novo.scss.
import '../detalhe/detalhe.scss'
import './novo.scss'

const PRIORIDADES: Prioridade[] = ['low', 'normal', 'high', 'urgent']

/** Mesma allowlist de `ATTACHMENT_ALLOWED_MIME` — para o `accept` do seletor
 *  e um aviso cedo. Quem decide é o backend, por magic bytes. */
const TIPOS_ACEITOS =
  'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,application/zip,.docx,.xlsx,.pptx'

/** Separa o que a pessoa escreveu da assinatura — e permite validar só o
 *  texto (a assinatura sozinha não conta como "mensagem preenchida"). */
const SEP_ASSINATURA = '\n\n--\n'

/** Só o que o aviso de duplicidade (abaixo) mostra. */
interface ChamadoResumo {
  id: number
  reference: string
}

/**
 * Chamados abertos que ESTE agente enxerga para a empresa do solicitante —
 * mesmos filtros que a listagem já aceita (`company`, `status` separado por
 * vírgula: apps/tickets/views.py `TicketViewSet.list`, parâmetros documentados
 * nas linhas 254-266). `Ticket.visible_to` (apps/tickets/models.py) já recorta
 * por equipe/atribuição ANTES desse filtro — por isso o aviso mais abaixo diz
 * "que você enxerga", nunca "ao todo": um agente sem escopo `ALL` pode não ver
 * tudo que o cliente tem aberto, e prometer a lista inteira seria mentira.
 * `enabled` some quando o solicitante não tem empresa: não tem `company` para
 * filtrar, e isso é "não dá para checar", não "não tem nenhum".
 */
function useChamadosAbertosDaEmpresa(empresaId: number | null) {
  return useQuery({
    queryKey: ['chamados-abertos-empresa', empresaId],
    queryFn: () =>
      api.get<Paginado<ChamadoResumo>>(
        `/api/v1/tickets/?company=${empresaId}&status=new,open,pending_customer&limit=3`,
      ),
    enabled: empresaId != null,
    staleTime: 30_000,
  })
}

/**
 * Um rascunho (`./rascunho.ts`) só guarda o ID do solicitante — sem nome,
 * e-mail ou empresa para mostrar no cartão (o formato gravado é fixo, e mudar
 * isso é mexer num arquivo que não é meu). Busca a pessoa por id
 * (`GET /api/v1/users/{id}/`, o mesmo `UserViewSet` de `useClientes`/
 * `useAgentes`, aqui direto porque é UMA pessoa, não uma lista) só quando a
 * tela abre com um id herdado — depois que o estado local guarda o objeto
 * inteiro (escolha feita na própria visita), esta consulta nem roda.
 */
function useSolicitantePorId(id: number | null) {
  return useQuery({
    queryKey: ['solicitante-por-id', id],
    queryFn: () => api.get<UsuarioDiretorio>(`/api/v1/users/${id}/`),
    enabled: id != null,
    retry: false,
  })
}

type NomeCampo =
  'requester_id' | 'team_id' | 'subject' | 'body' | 'files' | 'category_id' | 'order_number'

/** Ordem em que os campos aparecem na tela — o foco vai para o PRIMEIRO
 *  inválido nessa ordem (WCAG 3.3.1: erro identificado e alcançável). O painel
 *  de triagem é a coluna da esquerda, por isso vem antes da redação. */
const ORDEM_FOCO: NomeCampo[] = [
  'team_id',
  'category_id',
  'order_number',
  'requester_id',
  'subject',
  'body',
  'files',
]

/** O backend erra por CAMPO (`{"team_id": [...]}`, `{"files": "..."}` —
 *  apps/tickets/serializers.py e views.py). O que não é campo desta tela
 *  (`non_field_errors`, campo de um fluxo que ela não usa) não pode sumir em
 *  silêncio: vira mensagem geral. */
function ehCampoDaTela(nome: string): nome is NomeCampo {
  return ORDEM_FOCO.includes(nome as NomeCampo)
}

function Obrigatorio() {
  return (
    <abbr className="novo__obrig" title="obrigatório">
      *
    </abbr>
  )
}

/**
 * Estado de erro de uma consulta que alimenta um campo (equipe, categoria,
 * "para") — sem isto um 500 em `/teams/`, `/categories/` ou `/users/` fica
 * IDÊNTICO a "ainda carregando" (o único teste que havia era `== null`): a
 * pessoa espera para sempre ou recarrega a página inteira no chute, perdendo
 * o que já tinha escrito. `id` mantém o elo com o `aria-describedby` do
 * campo quando substitui a ajuda normal — mesmo motivo de `${id}-ajuda` no
 * resto do arquivo.
 */
function ErroConsulta({
  id,
  mensagem,
  aoTentar,
}: {
  id?: string
  mensagem: string
  aoTentar: () => void
}) {
  return (
    <span id={id} className="novo__erro-consulta" role="alert">
      <i className="ti ti-alert-circle" aria-hidden="true" /> {mensagem}{' '}
      <button type="button" className="novo__link" onClick={aoTentar}>
        Tentar de novo
      </button>
    </span>
  )
}

/**
 * O `Seletor` do painel do detalhe (../detalhe/PainelPropriedades.tsx) com o
 * que um FORMULÁRIO precisa e o detalhe não tem: `aria-invalid` e
 * `aria-describedby`. Lá cada campo salva sozinho e nunca fica "inválido";
 * aqui o envio recusa o formulário inteiro, e sem essas duas ligações o leitor
 * de tela anuncia "Equipe, caixa de combinação" sem dizer que ela está errada
 * nem qual é o texto de ajuda ao lado (WCAG 3.3.1 e 1.3.1). As classes são as
 * mesmas (.props__seletor), então o controle continua idêntico na tela.
 */
function SeletorCampo({
  id,
  icone,
  cor,
  valor,
  onChange,
  desabilitado,
  invalido,
  descrito,
  children,
}: {
  id: string
  icone?: string
  cor?: string
  valor: string
  onChange: (v: string) => void
  desabilitado?: boolean
  invalido?: boolean
  descrito?: string
  children: ReactNode
}) {
  return (
    <span className={'props__seletor' + (invalido ? ' novo__seletor--invalido' : '')}>
      {cor ? (
        <span className="props__cor" style={{ background: cor }} aria-hidden="true" />
      ) : icone ? (
        <i className={icone} aria-hidden="true" />
      ) : null}
      <select
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        disabled={desabilitado}
        aria-invalid={invalido || undefined}
        aria-describedby={descrito}
      >
        {children}
      </select>
      <i className="ti ti-chevron-down props__seta" aria-hidden="true" />
    </span>
  )
}

/**
 * Abrir chamado — o agente abre em nome de um cliente.
 *
 * O que mudou em relação à tela anterior (cvz), e por quê:
 *  - vive no shell Resolv, como a lista e o detalhe: o fluxo lista → novo →
 *    detalhe não troca mais de design system no meio;
 *  - hierarquia: "Para / Assunto / Mensagem" (o que o cliente lê) é a coluna
 *    principal; a triagem fica no painel de propriedades, no mesmo lugar e
 *    com os mesmos controles do detalhe;
 *  - obrigatório é marcado (*), em vez de "opcional" espalhado em ajudas;
 *    o foco vai para o primeiro campo inválido ao enviar;
 *  - saíram os controles que não faziam nada: a aba "Ação interna" inerte,
 *    o contador de palavras e a toolbar B/I/lista/link — o produto mostra
 *    texto puro, então `**negrito**` chegaria literal ao cliente;
 *  - anexos: botão com nome e lista visível, como no compositor do detalhe;
 *  - Ctrl+Enter abre o chamado; sair com texto escrito pede confirmação e o
 *    rascunho fica guardado (./rascunho.ts), inclusive para navegação interna,
 *    que o `beforeunload` não vê.
 *
 * Chamado criado é FIM DE TELA: o formulário sai e dá lugar à confirmação.
 */
export function PaginaNovoTicket() {
  const navigate = useNavigate()
  const idBase = useId()
  const { data: me } = useMe()

  // isError/refetch (não só `data`): um 500 aqui não pode ficar indistinguível
  // de "ainda carregando" — ver `ErroConsulta` acima.
  const { data: equipes, isError: falhouEquipes, refetch: recarregarEquipes } = useEquipes()
  const { data: servicos } = useServicos()
  const {
    data: categorias,
    isError: falhouCategorias,
    refetch: recarregarCategorias,
  } = useCategorias()
  const { data: empresas } = useEmpresasOpcoes()
  const { data: agentes } = useAgentes()
  const { data: etiquetas } = useEtiquetas()
  const { data: macros } = useMacros()
  const { data: configSistema } = useSistemaCfg()

  // Só depende de `empresas` (carregado acima) — vem cedo porque a busca de
  // solicitante (mais abaixo) e o cartão do cliente escolhido usam os dois.
  const empresaPorId = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e])), [empresas])
  const nomeEmpresa = (id: number | null | undefined) =>
    id != null ? (empresaPorId.get(id)?.name ?? '') : ''

  // Rascunho da visita anterior, lido UMA vez: cada campo abaixo já nasce com
  // o que estava escrito, sem um efeito que sobrescreveria o que a pessoa
  // digitar enquanto as queries chegam.
  const [rascunhoSalvo] = useState(lerRascunho)

  const [empresaId, setEmpresaId] = useState<number | null>(rascunhoSalvo?.empresaId ?? null)
  const [solicitanteId, setSolicitanteId] = useState<number | null>(
    rascunhoSalvo?.solicitanteId ?? null,
  )
  // O objeto inteiro de quem foi escolhido NESTA visita — o rascunho só grava
  // o id (rascunho.ts), e a busca no servidor (abaixo) não mantém uma lista
  // viva de todo mundo pra procurar depois nela: quem escolhe guarda o que
  // precisa mostrar (nome, e-mail, empresa) na hora da escolha, não relê de
  // uma lista que já pode ter mudado (ou ter zerado, se o campo "Para" está
  // vazio de novo). Um id herdado do rascunho (visita anterior) NÃO entra
  // aqui — vira `solicitante` (mais abaixo) por outro caminho, sem precisar
  // de um efeito só para copiar o resultado da consulta pra este estado.
  const [solicitanteEscolhidoManualmente, setSolicitanteEscolhidoManualmente] =
    useState<SolicitanteEncontrado | null>(null)
  const [equipeId, setEquipeId] = useState(rascunhoSalvo?.equipeId ?? '')
  const [assunto, setAssunto] = useState(rascunhoSalvo?.assunto ?? '')
  const [texto, setTexto] = useState(rascunhoSalvo?.texto ?? '')
  const [prioridade, setPrioridade] = useState<Prioridade>(rascunhoSalvo?.prioridade ?? 'normal')
  const [servicoId, setServicoId] = useState(rascunhoSalvo?.servicoId ?? '')
  const [categoriaId, setCategoriaId] = useState(rascunhoSalvo?.categoriaId ?? '')
  const [numeroPedido, setNumeroPedido] = useState(rascunhoSalvo?.numeroPedido ?? '')
  const [responsavelId, setResponsavelId] = useState(rascunhoSalvo?.responsavelId ?? '')
  const [tagIds, setTagIds] = useState<number[]>(rascunhoSalvo?.tagIds ?? [])
  const [anexos, setAnexos] = useState<File[]>([])
  const [assinaturaLigada, setAssinaturaLigada] = useState(rascunhoSalvo?.assinaturaLigada ?? true)
  const [erros, setErros] = useState<Partial<Record<NomeCampo, string>>>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [menuMacro, setMenuMacro] = useState(false)
  const [avisoRascunho, setAvisoRascunho] = useState(
    () => rascunhoSalvo != null && estaSujo(rascunhoSalvo),
  )
  /** Chamado aberto: a tela vira confirmação. Guarda o que o formulário vai
   *  deixar de mostrar (referência, assunto, cliente) e o que das etapas
   *  seguintes não colou. */
  const [criado, setCriado] = useState<{
    id: number
    referencia: string
    assunto: string
    cliente: string
    pendencias: string[]
  } | null>(null)
  /** Id do campo que deve receber o foco no próximo render — o alvo ainda não
   *  existe na hora do clique (o formulário volta depois da confirmação).
   *  Ref, não estado: quem escreve aqui já está mudando estado de verdade, e
   *  isto não deve provocar um render por si. */
  const focoPedidoRef = useRef<string | null>(null)

  // Busca de solicitante no SERVIDOR (`GET /api/v1/search/`, o mesmo endpoint
  // e HOOK do cabeçalho — `useBuscaGlobal`, frontend/src/api/busca.ts): o
  // diretório inteiro (`useClientes`) tinha teto de 500 pessoas — acima
  // disso, quem estivesse depois da 500ª posição alfabética simplesmente não
  // existia pra esta tela. `termoSolicitante` é o que a pessoa está digitando
  // agora (via `BuscaPessoa`); `termoSolicitanteBuscado` é a versão com 250ms
  // de folga — MESMO idioma do debounce de `BuscaGlobal.tsx` (o próprio hook
  // não debounca; quem chama é que segura a tecla antes de gastar requisição).
  const [termoSolicitante, setTermoSolicitante] = useState('')
  const [termoSolicitanteBuscado, setTermoSolicitanteBuscado] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTermoSolicitanteBuscado(termoSolicitante), 250)
    return () => clearTimeout(t)
  }, [termoSolicitante])
  const {
    data: buscaSolicitantes,
    isLoading: carregandoBuscaSolicitantes,
    isError: falhouBuscaSolicitantes,
    refetch: refazerBuscaSolicitantes,
  } = useBuscaGlobal(termoSolicitanteBuscado)
  const termoSolicitanteLimpo = termoSolicitante.trim()
  const podeBuscarSolicitante = termoSolicitanteLimpo.length >= MINIMO_PARA_BUSCAR
  // Cobre os dois silêncios — debounce contando e requisição em voo — do
  // ponto de vista de quem digitou, não da query (mesma ideia de `esperando`
  // em BuscaGlobal.tsx).
  const carregandoSolicitantes =
    podeBuscarSolicitante &&
    (termoSolicitanteBuscado.trim() !== termoSolicitanteLimpo || carregandoBuscaSolicitantes)

  // `create_ticket` exige solicitante ATIVO (apps/tickets/views.py) — um
  // inativo aqui é uma opção que o servidor sempre recusaria (o motivo de
  // `is_active` existir em `SolicitanteEncontrado`, ver frontend/src/api/
  // busca.ts). A busca global não filtra por empresa (não é o contrato dela);
  // o filtro de empresa acima do campo "Para" (`empresaId`) entra aqui como
  // recorte LOCAL sobre o que a busca já trouxe — mais estreito do que o
  // `useClientes(empresaId)` de antes (que perguntava ao servidor pela
  // empresa inteira), mas é o que o endpoint de busca permite hoje.
  const solicitantesAtivos = useMemo(
    () =>
      (buscaSolicitantes?.requesters ?? []).filter(
        (r) => r.is_active && (empresaId == null || r.company_id === empresaId),
      ),
    [buscaSolicitantes, empresaId],
  )

  // Rascunho recuperado só tem o id (ver `useSolicitantePorId` acima) — busca
  // a pessoa uma vez pra repor nome/e-mail/empresa no cartão. Só roda enquanto
  // ninguém foi escolhido NESTA visita: uma escolha feita agora
  // (`escolherSolicitante` abaixo) já tem o objeto inteiro e não precisa de
  // rede pra se exibir.
  const { data: solicitanteHerdado, error: erroSolicitanteHerdado } = useSolicitantePorId(
    solicitanteEscolhidoManualmente == null ? solicitanteId : null,
  )
  // 404 = o id do rascunho não existe mais pra este agente (removido ou
  // desativado — mesmo caso de antes, quando a pessoa sumia do diretório
  // carregado). Um erro de REDE aqui não é o mesmo caso: `solicitanteId` (o
  // valor CRU, usado no envio/rascunho abaixo) fica como estava, porque um id
  // válido não pode virar "ninguém escolhido" só por uma falha passageira na
  // reidratação — o `retry: false` do hook já cobre a segunda tentativa
  // automática, isto aqui é só sobre CONFIAR ou não no id depois da resposta.
  const solicitanteIdInexistente =
    erroSolicitanteHerdado instanceof ApiError && erroSolicitanteHerdado.status === 404
  const solicitanteIdValido = solicitanteIdInexistente ? null : solicitanteId

  // `solicitante` é o que a tela MOSTRA: a escolha desta visita quando existe,
  // senão o resultado da reidratação por id (mapeado pro mesmo formato de
  // `SolicitanteEncontrado` — `busca.ts` — pra alimentar cartão, macro e o
  // aviso de duplicidade de um jeito só, sem `if` espalhado). Derivado a cada
  // render (não um `useEffect` copiando pra outro estado): o dado já mora no
  // cache do react-query, e as duas fontes nunca ficam ativas ao mesmo tempo.
  const solicitante = useMemo<SolicitanteEncontrado | null>(() => {
    if (solicitanteEscolhidoManualmente) return solicitanteEscolhidoManualmente
    if (!solicitanteHerdado) return null
    return {
      id: solicitanteHerdado.id,
      full_name: solicitanteHerdado.full_name,
      email: solicitanteHerdado.email,
      company_id: solicitanteHerdado.company,
      company_name: nomeEmpresa(solicitanteHerdado.company) || null,
      is_active: true, // UserViewSet.get_queryset só devolve is_active=True
    }
    // `nomeEmpresa` fica de fora do jeito que `pessoas`/`empresaDoSolicitante`
    // já fazem: função pura recriada a cada render, cujo resultado só muda
    // com `empresaPorId` (já coberto abaixo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitanteEscolhidoManualmente, solicitanteHerdado])

  // O escolhido precisa continuar "encontrável" mesmo depois que o campo
  // volta a ficar vazio (a escolha limpa `termoSolicitante`, e a busca por ''
  // não roda) — sem isto `BuscaPessoa` não acha o id em `opcoes` e o campo
  // mostra vazio para alguém que já foi escolhido.
  const pessoas = useMemo(() => {
    const base = solicitantesAtivos.map((s) => ({
      id: s.id,
      nome: s.full_name,
      descricao: [s.email, s.company_name].filter(Boolean).join(' · '),
    }))
    if (solicitante && !base.some((p) => p.id === solicitante.id)) {
      base.push({
        id: solicitante.id,
        nome: solicitante.full_name,
        descricao: [solicitante.email, solicitante.company_name].filter(Boolean).join(' · '),
      })
    }
    return base
  }, [solicitantesAtivos, solicitante])

  const abrir = useAbrirTicket()

  const paraRef = useRef<HTMLInputElement>(null)
  const inputAnexo = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const feitoRef = useRef<HTMLDivElement>(null)
  const semEquipeRef = useRef<HTMLDivElement>(null)
  const enviadoRef = useRef(false)

  const assinatura = (me?.signature ?? '').trim()

  const ids = {
    equipe: `${idBase}-equipe`,
    resp: `${idBase}-resp`,
    prio: `${idBase}-prio`,
    servico: `${idBase}-servico`,
    cat: `${idBase}-cat`,
    pedido: `${idBase}-pedido`,
    empresa: `${idBase}-empresa`,
    para: `${idBase}-para`,
    assunto: `${idBase}-assunto`,
    texto: `${idBase}-texto`,
    anexar: `${idBase}-anexar`,
  }
  // `files` aponta para o botão "Anexar", não para a mensagem: era o mesmo id
  // de `body`, o que gerava DOIS elementos `-erro` com o mesmo id na página e
  // mandava o foco de um anexo recusado para o textarea.
  const idDoCampo: Record<NomeCampo, string> = {
    team_id: ids.equipe,
    requester_id: ids.para,
    subject: ids.assunto,
    body: ids.texto,
    files: ids.anexar,
    category_id: ids.cat,
    order_number: ids.pedido,
  }

  // Limites de anexo do SERVIDOR (SystemConfig), não constante da tela: o
  // "20 MB" que estava cravado aqui não era o limite real nem em produção
  // (10 MB), e prometer folga que o backend não dá era o caminho do chamado
  // duplicado. A conferência é a MESMA do compositor do detalhe — as duas
  // telas dividem `../anexos`, senão elas divergem (e já tinham divergido:
  // esta não recusava extensão bloqueada).
  const limites = limitesDeAnexo(configSistema)

  // A tela abre com o foco em "Para": é o primeiro campo da tarefa
  // principal (escrever para alguém), e evita sete tabs pelo painel de
  // triagem antes de começar.
  useEffect(() => {
    paraRef.current?.focus()
  }, [])

  // Foco pedido por uma ação que troca a árvore (voltar da confirmação para o
  // formulário) — no clique o campo ainda não existia. Sem lista de
  // dependências de propósito: o pedido é consumido no primeiro render depois
  // do clique, qualquer que seja o estado que mudou junto.
  useEffect(() => {
    const alvo = focoPedidoRef.current
    if (!alvo) return
    focoPedidoRef.current = null
    document.getElementById(alvo)?.focus()
  })

  // Confirmação de chamado aberto: leva o foco para ela. Sem isso o foco fica
  // no botão "Abrir chamado" que acabou de sumir e volta para o <body>, e
  // quem navega por teclado não sabe que a tela trocou.
  useEffect(() => {
    if (criado) feitoRef.current?.focus()
  }, [criado])

  // menu de macro fecha ao clicar fora / Esc
  useEffect(() => {
    if (!menuMacro) return
    const fora = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuMacro(false)
    }
    const tecla = (e: globalThis.KeyboardEvent) => {
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
    const h = setTimeout(() => setAviso(null), 6000)
    return () => clearTimeout(h)
  }, [aviso])

  /**
   * Um agente só abre chamado nas equipes que ATENDE — a regra é do backend
   * (ticket_service.create_ticket) e `me.teams` traz exatamente esses slugs.
   * Filtrar aqui não é autorização: é não oferecer uma opção que sempre
   * voltaria erro. Admin não tem recorte.
   */
  const equipesDisponiveis = useMemo(() => {
    if (!equipes) return []
    if (me?.is_admin) return equipes
    const minhas = new Set(me?.teams ?? [])
    return equipes.filter((e) => minhas.has(e.slug))
  }, [equipes, me])
  const semEquipe = me != null && !me.is_admin && equipes != null && equipesDisponiveis.length === 0

  // Com uma equipe só, ela é o ÚNICO valor que o backend aceita (mesma regra
  // do filtro acima) — nascer vazio só adiava uma escolha sem alternativa
  // para o momento do envio, sendo o primeiro campo a reprovar. O setter
  // funcional lê o valor ATUAL sem entrar nas dependências: o efeito só
  // dispara de novo quando `equipesDisponiveis` muda (equipes/`me` chegando),
  // nunca por causa de uma limpeza manual do campo — a pessoa pode voltar a
  // esvaziar o seletor e isso não briga de volta. Sincroniza estado local com
  // o resultado assíncrono de duas queries (não deriva de props/estado já
  // disponível no render), então é o próprio caso que `useEffect` existe para
  // cobrir — mesmo escape hatch já usado em AppShell.tsx para "ajustar um
  // estado uma vez, sem brigar com a escolha manual depois".
  useEffect(() => {
    if (equipesDisponiveis.length !== 1) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver acima
    setEquipeId((atual) => (atual === '' ? String(equipesDisponiveis[0].id) : atual))
  }, [equipesDisponiveis])

  // Beco sem saída de verdade (só um admin resolve, incluindo a pessoa numa
  // equipe — um "tentar de novo" não muda nada): a tela troca o formulário
  // inteiro pela explicação (ver o `return` mais abaixo), e o foco precisa ir
  // junto — mesmo motivo do efeito de `feitoRef`, a árvore troca sem clique
  // direto no que recebe o foco.
  useEffect(() => {
    if (semEquipe) semEquipeRef.current?.focus()
  }, [semEquipe])

  const equipeEscolhida = equipesDisponiveis.find((e) => String(e.id) === equipeId)
  const { data: estimativa } = useEstimativaResposta(equipeEscolhida?.slug ?? null)

  /**
   * Responsável e etiquetas exigem `ticket.edit_properties` — a mesma
   * permissão que já decide o painel do TICKET ABERTO
   * (../detalhe/PainelPropriedades.tsx: `podeEditar`). Lá, sem a permissão, o
   * controle vira valor fixo porque HÁ um valor do ticket para mostrar; aqui
   * o ticket ainda não existe (não há "responsável atual" nenhum) — então o
   * equivalente correto é não oferecer o campo, não exibir um "Sem
   * responsável" que não é fixo coisa nenhuma, só decorativo.
   */
  const podeEditarPropriedades = (me?.permissions ?? []).includes('ticket.edit_properties')

  const empresaDoSolicitante = solicitante
    ? empresaPorId.get(solicitante.company_id ?? -1)
    : undefined

  // Aviso de duplicidade: "fulano já tem chamado aberto" — só dá pra checar
  // com a empresa REAL do solicitante (`company_id`), não com o filtro solto
  // acima do campo "Para" (`empresaId`, que é só recorte de busca). Sem
  // empresa vinculada o hook nem roda (`enabled` em `useChamadosAbertosDaEmpresa`):
  // "não dá pra checar" é diferente de "não tem nenhum aberto".
  const { data: chamadosAbertos } = useChamadosAbertosDaEmpresa(solicitante?.company_id ?? null)

  /** Categoria depende do serviço — o filtro é do frontend por decisão do
   *  backend (ServiceSerializer). Sem serviço escolhido, oferece todas. */
  const categoriasDoServico = useMemo(() => {
    if (!categorias) return []
    if (!servicoId) return categorias
    return categorias.filter((c) => c.service === Number(servicoId))
  }, [categorias, servicoId])
  const temServicos = (servicos?.length ?? 0) > 0
  const temEtiquetas = (etiquetas?.length ?? 0) > 0

  // Uma só descrição do formulário serve para três coisas: gravar o rascunho,
  // decidir se há trabalho a perder e montar o aviso do que foi recuperado.
  const rascunho: Rascunho = useMemo(
    () => ({
      empresaId,
      solicitanteId: solicitanteIdValido,
      equipeId,
      assunto,
      texto,
      prioridade,
      servicoId,
      categoriaId,
      numeroPedido,
      responsavelId,
      tagIds,
      assinaturaLigada,
      anexos: anexos.map((f) => f.name),
    }),
    [
      empresaId,
      solicitanteIdValido,
      equipeId,
      assunto,
      texto,
      prioridade,
      servicoId,
      categoriaId,
      numeroPedido,
      responsavelId,
      tagIds,
      assinaturaLigada,
      anexos,
    ],
  )
  const sujo = estaSujo(rascunho)
  // Chamado já aberto não tem rascunho a guardar — e o `false` aqui é o que
  // apaga o que estava gravado.
  useGravarRascunho(rascunho, sujo && criado == null)

  // Sair com o formulário mexido (fechar aba, F5) pede confirmação — o
  // navegador mostra o diálogo dele. Navegação interna não passa por aqui: é
  // o rascunho que cobre esse caso.
  useEffect(() => {
    if (!sujo) return
    const h = (e: BeforeUnloadEvent) => {
      if (enviadoRef.current) return
      e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [sujo])

  function limparErro(campo: NomeCampo) {
    setErros((atuais) => {
      if (!(campo in atuais)) return atuais
      const { [campo]: _removido, ...resto } = atuais
      return resto
    })
  }

  function trocarEmpresa(valor: string) {
    setEmpresaId(valor === '' ? null : Number(valor))
    // quem estava escolhido pode não ser dessa empresa — limpar é mais
    // honesto do que mandar um par empresa/pessoa que não combina
    setSolicitanteId(null)
    setSolicitanteEscolhidoManualmente(null)
  }

  function escolherSolicitante(id: number | null) {
    setSolicitanteId(id)
    limparErro('requester_id')
    // Guarda o objeto INTEIRO agora, não só o id: `solicitantesAtivos` é o
    // resultado da busca atual, que muda (e pode esvaziar) assim que o campo
    // volta a ficar em branco — reler dali mais tarde não acharia mais
    // ninguém.
    const s = id != null ? solicitantesAtivos.find((x) => x.id === id) : undefined
    setSolicitanteEscolhidoManualmente(s ?? null)
    // macro aplicada antes de escolher a pessoa deixou marcadores no texto:
    // agora dá para preenchê-los — só eles, nunca o que o agente digitou
    if (s) {
      setTexto((atual) =>
        marcadoresPendentes(atual).length
          ? interpolarMacro(atual, {
              solicitante: s.full_name,
              empresa: s.company_name ?? undefined,
            })
          : atual,
      )
    }
  }

  function trocarServico(valor: string) {
    setServicoId(valor)
    setCategoriaId('') // a categoria escolhida pode não ser desse serviço
  }

  function alternarEtiqueta(id: number) {
    setTagIds((atuais) => (atuais.includes(id) ? atuais.filter((t) => t !== id) : [...atuais, id]))
  }

  /**
   * Confere o que o backend confere (apps/tickets/services/attachments.py:
   * `validar_uploads`) — tamanho por arquivo, soma da mensagem e contagem —
   * usando os limites que ele mesmo publicou.
   *
   * Sem os limites carregados, aceita e deixa o servidor decidir: recusar por
   * um número inventado esconderia um arquivo que passaria, e o 400 do
   * servidor agora acontece ANTES de criar o chamado (views.py:create), então
   * ele não deixa mais chamado órfão.
   */
  function adicionarAnexos(lista: FileList | null) {
    if (!lista?.length) return
    const { aceitos, recusas } = conferirAnexos(anexos, Array.from(lista), limites)
    setAnexos((a) => [...a, ...aceitos])
    if (recusas.length) setErros((e) => ({ ...e, files: recusas.join(' ') }))
    else limparErro('files')
  }

  /**
   * Macro aplicada AQUI, no formulário: o endpoint `apply-macro` só existe
   * para ticket criado, e o backend define que o texto da macro é
   * responsabilidade do front. Campo vazio na macro não apaga o que já está
   * preenchido — mesma regra do servidor (soma, não zera).
   */
  function usarMacro(m: Macro) {
    setMenuMacro(false)
    const corpo = interpolarMacro(m.body ?? '', {
      solicitante: solicitante?.full_name,
      empresa: solicitante?.company_name ?? undefined,
    })
    if (corpo) {
      setTexto((t) => (t.trim() ? `${t}\n${corpo}` : corpo))
      limparErro('body')
    }
    if (m.category != null) {
      setCategoriaId(String(m.category))
      // mantém o filtro de serviço coerente com a categoria que entrou
      const cat = (categorias ?? []).find((c) => c.id === m.category)
      if (cat?.service != null) setServicoId(String(cat.service))
    }
    if (m.priority) setPrioridade(m.priority)
    if (m.assignee != null) setResponsavelId(String(m.assignee))
    if (m.tags?.length) setTagIds((atuais) => [...new Set([...atuais, ...m.tags!])])
    const pendentes = marcadoresPendentes(corpo)
    setAviso(
      pendentes.length
        ? `Macro “${m.name}” aplicada — ${pendentes.join(', ')} será preenchido quando você escolher o solicitante.`
        : `Macro “${m.name}” aplicada.`,
    )
    document.getElementById(ids.texto)?.focus()
  }

  function validar(): Partial<Record<NomeCampo, string>> {
    const e: Partial<Record<NomeCampo, string>> = {}
    if (!equipeId) e.team_id = 'Escolha a equipe que vai atender.'
    if (solicitanteIdValido == null) e.requester_id = 'Escolha para quem o chamado é aberto.'
    if (!assunto.trim()) e.subject = 'Resuma o chamado em uma linha.'
    if (!texto.trim()) {
      e.body = 'Escreva a mensagem — ela abre o chamado para o cliente.'
    } else {
      // última barreira antes de o texto virar mensagem para o cliente: um
      // marcador que sobrou da macro chegaria ao pé da letra
      const pendentes = marcadoresPendentes(texto)
      if (pendentes.length) {
        e.body = `Troque ${pendentes.join(' e ')} pelo valor real — o cliente lê este texto.`
      }
    }
    return e
  }

  function focarPrimeiroInvalido(e: Partial<Record<NomeCampo, string>>) {
    const primeiro = ORDEM_FOCO.find((c) => c in e)
    if (primeiro) document.getElementById(idDoCampo[primeiro])?.focus()
  }

  function limparFormulario() {
    setAssunto('')
    setTexto('')
    setAnexos([])
    setTagIds([])
    setNumeroPedido('')
    setResponsavelId('')
    setCategoriaId('')
    setServicoId('')
    setPrioridade('normal')
    setErros({})
    setErroGeral(null)
    setAviso(null)
  }

  /** Volta ao formulário mantendo empresa, cliente e equipe: é o mesmo
   *  atendimento seguindo. Reescolher os três a cada chamado é o que fazia a
   *  pessoa voltar no navegador — e reenviar o formulário anterior. */
  function abrirOutroParaMesmoCliente() {
    limparFormulario()
    setCriado(null)
    enviadoRef.current = false
    focoPedidoRef.current = ids.assunto
  }

  function descartarRascunho() {
    limparFormulario()
    setEmpresaId(null)
    setSolicitanteId(null)
    setSolicitanteEscolhidoManualmente(null)
    setEquipeId('')
    setAssinaturaLigada(true)
    setAvisoRascunho(false)
    limparRascunho()
    focoPedidoRef.current = ids.para
  }

  async function enviar() {
    if (abrir.isPending || criado) return
    setErroGeral(null)
    const invalidos = validar()
    if (Object.keys(invalidos).length) {
      setErros((atuais) => ({ ...atuais, ...invalidos }))
      focarPrimeiroInvalido(invalidos)
      return
    }

    const corpo =
      assinaturaLigada && assinatura
        ? `${texto.trim()}${SEP_ASSINATURA}${assinatura}`
        : texto.trim()

    try {
      const { ticket, pendencias } = await abrir.mutateAsync({
        team_id: Number(equipeId),
        subject: assunto.trim(),
        body: corpo,
        priority: prioridade,
        requester_id: solicitanteIdValido!,
        category_id: categoriaId ? Number(categoriaId) : null,
        order_number: numeroPedido.trim(),
        arquivos: anexos,
        // Guarda mesmo sem controle na tela: um rascunho gravado enquanto a
        // pessoa TINHA a permissão (perfil trocado depois) não pode enviar,
        // por baixo dos panos, um campo que a tela agora nem mostra.
        assignee_id: podeEditarPropriedades && responsavelId ? Number(responsavelId) : null,
        tag_ids: podeEditarPropriedades ? tagIds : [],
      })
      enviadoRef.current = true
      limparRascunho()
      if (pendencias.length) {
        setCriado({
          id: ticket.id,
          referencia: ticket.reference,
          assunto: assunto.trim(),
          cliente: solicitante?.full_name ?? '',
          pendencias,
        })
        return
      }
      navigate(`/chamados/${ticket.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) {
        // O cliente HTTP normaliza as duas formas do backend — `["msg"]` do
        // serializer e `"msg"` cru da view que valida na mão (src/api/client.ts,
        // apps/tickets/views.py) — então "Cliente não encontrado." e a recusa
        // do anexo chegam no campo, e não como "Erro 400".
        const porCampo: Partial<Record<NomeCampo, string>> = {}
        const semCampo: string[] = []
        for (const [campo, mensagens] of Object.entries(e.fieldErrors)) {
          const texto = mensagens[0]
          if (!texto) continue
          if (ehCampoDaTela(campo)) porCampo[campo] = texto
          else semCampo.push(texto)
        }
        if (porCampo.files) {
          // O anexo passou a ser conferido ANTES de `create_ticket`
          // (apps/tickets/views.py:create): 400 em `files` significa agora que
          // nada foi criado. Dizer isso é o que impede o agente de achar que o
          // chamado nasceu e abrir um segundo por precaução.
          porCampo.files = `${porCampo.files} Nenhum chamado foi aberto — troque o arquivo e envie de novo.`
        }
        setErros((atuais) => ({ ...atuais, ...porCampo }))
        focarPrimeiroInvalido(porCampo)
        const geral = [e.detail, ...semCampo].filter(Boolean).join(' ')
        setErroGeral(geral || null)
      } else {
        setErroGeral(
          `${mensagemDeErro(e, 'Não foi possível abrir o chamado.')} Nada foi perdido — o texto continua aqui.`,
        )
      }
    }
  }

  function cancelar() {
    if (sujo && !window.confirm('Descartar o chamado que você começou a escrever?')) return
    enviadoRef.current = true
    limparRascunho()
    navigate('/chamados')
  }

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void enviar()
    }
  }

  const descreve = (campo: NomeCampo, ajuda?: string) =>
    [ajuda, erros[campo] ? `${idDoCampo[campo]}-erro` : undefined].filter(Boolean).join(' ') ||
    undefined

  // função, não componente: declarar um componente aqui dentro o remontaria
  // a cada render (e o lint do React recusa)
  const erroDe = (campo: NomeCampo) =>
    erros[campo] ? (
      <span id={`${idDoCampo[campo]}-erro`} className="novo__erro" role="alert">
        <i className="ti ti-alert-circle" aria-hidden="true" /> {erros[campo]}
      </span>
    ) : null

  // O chamado existe: o formulário SAI da tela. Ele continuava montado e
  // habilitado embaixo do aviso, com tudo preenchido — lia-se como "deu erro,
  // tente de novo", e o clique seguinte abria um chamado idêntico.
  if (criado) {
    return (
      <div className="novo">
        <header className="ticket-cab novo__cab">
          <div className="ticket-cab__linha">
            <div className="ticket-cab__identidade novo__identidade">
              <h1 className="ticket-cab__assunto">Chamado aberto</h1>
              <span className="novo__cab-sub">{criado.assunto}</span>
            </div>
          </div>
        </header>

        {/* o foco vai para o bloco (tabIndex -1) e o `status` fica na frase:
            um live region embrulhando os botões faria o leitor de tela reler a
            tela inteira a cada mudança dentro dela */}
        <div className="novo__feito" ref={feitoRef} tabIndex={-1}>
          <p className="novo__feito-linha" role="status">
            <i className="ti ti-circle-check" aria-hidden="true" />
            <span>
              <strong>{criado.referencia}</strong> foi aberto
              {criado.cliente ? ` para ${criado.cliente}` : ''}.
            </span>
          </p>
          {criado.pendencias.length > 0 && (
            <p className="novo__feito-pendencia">
              <i className="ti ti-alert-triangle" aria-hidden="true" />
              <span>
                O chamado está lá, mas {criado.pendencias.join(' e ')} — dá para ajustar no próprio
                chamado.
              </span>
            </p>
          )}
          <div className="novo__feito-acoes">
            <button
              type="button"
              className="compositor__botao"
              onClick={() => navigate(`/chamados/${criado.id}`)}
            >
              Abrir {criado.referencia}
            </button>
            <button type="button" className="novo__cancelar" onClick={abrirOutroParaMesmoCliente}>
              Abrir outro chamado{criado.cliente ? ` para ${criado.cliente}` : ''}
            </button>
            <button type="button" className="novo__link" onClick={() => navigate('/chamados')}>
              Voltar para a lista
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Sem equipe, não há chamado possível (o backend exige `team_id` —
  // ticket_service.create_ticket) e o <select> de Equipe fica sem NENHUMA
  // opção: preencher Para/Assunto/Mensagem para travar só no envio final é
  // pior do que nunca abrir o formulário. Troca o corpo pela explicação — a
  // mesma ideia de `lista.scss` `__estado` (ícone, frase, saída), com as
  // classes desta tela porque `novo.scss` não importa `lista.scss`.
  if (semEquipe) {
    return (
      <div className="novo">
        <header className="ticket-cab novo__cab">
          <div className="ticket-cab__linha">
            <button
              type="button"
              className="ticket-cab__voltar"
              onClick={cancelar}
              aria-label="Voltar para a lista de tickets"
              title="Voltar para a lista"
            >
              <i className="ti ti-arrow-left" />
            </button>
            <div className="ticket-cab__identidade novo__identidade">
              <h1 className="ticket-cab__assunto">Novo chamado</h1>
            </div>
          </div>
        </header>

        {/* foco no bloco (tabIndex -1), `status` só na frase — mesmo motivo
            do `.novo__feito` acima: um live region no bloco inteiro faria o
            leitor de tela reler tudo de novo a cada re-render à toa. */}
        <div className="novo__estado" ref={semEquipeRef} tabIndex={-1}>
          <i className="ti ti-users-group" aria-hidden="true" />
          <p role="status">Você não atende nenhuma equipe.</p>
          <p>
            Chamado sempre nasce numa equipe, e a abertura só oferece as equipes que você atende.
            Peça a um administrador para te incluir em uma.
          </p>
          <button type="button" className="novo__cancelar" onClick={cancelar}>
            Voltar para a fila
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="novo" onKeyDown={aoTeclar}>
      <header className="ticket-cab novo__cab">
        <div className="ticket-cab__linha">
          <button
            type="button"
            className="ticket-cab__voltar"
            onClick={cancelar}
            aria-label="Voltar para a lista de tickets"
            title="Voltar para a lista"
          >
            <i className="ti ti-arrow-left" />
          </button>
          <div className="ticket-cab__identidade novo__identidade">
            <h1 className="ticket-cab__assunto">Novo chamado</h1>
            <span className="novo__cab-sub">
              Aberto por você em nome de um cliente. Campos com <Obrigatorio /> são obrigatórios.
            </span>
          </div>
          <span className="ticket-cab__pilula" title="Todo chamado nasce como Novo">
            <span className="ticket-cab__ponto" style={{ ['--cor' as string]: 'var(--accent)' }} />
            Novo
          </span>
        </div>
      </header>

      <div className="novo__colunas">
        {/* ---------------- triagem: mesmo painel e controles do detalhe ---------------- */}
        <aside className="props novo__props" aria-label="Triagem do chamado">
          <section className="props__grupo">
            <h2 className="props__titulo">Atendimento</h2>

            <Campo
              rotulo={
                <>
                  Equipe <Obrigatorio />
                </>
              }
              htmlFor={ids.equipe}
            >
              <SeletorCampo
                id={ids.equipe}
                icone="ti ti-users-group"
                valor={equipeId}
                onChange={(v) => {
                  setEquipeId(v)
                  limparErro('team_id')
                }}
                desabilitado={equipes == null}
                invalido={Boolean(erros.team_id)}
                descrito={descreve('team_id', `${ids.equipe}-ajuda`)}
              >
                <option value="">
                  {equipes ? 'Selecione a equipe' : falhouEquipes ? 'Não carregou' : 'Carregando…'}
                </option>
                {equipesDisponiveis.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </SeletorCampo>
              {/* `semEquipe` (a pessoa não atende NENHUMA equipe) nem chega
                  aqui: vira o `return` de estado lá em cima. Aqui só sobra o
                  caso "a lista falhou ao carregar" — coisa que um retry pode
                  resolver, diferente do primeiro. */}
              {falhouEquipes ? (
                <ErroConsulta
                  id={`${ids.equipe}-ajuda`}
                  mensagem="Não foi possível carregar as equipes."
                  aoTentar={() => recarregarEquipes()}
                />
              ) : (
                <span className="props__ajuda" id={`${ids.equipe}-ajuda`}>
                  {estimativa?.label
                    ? `Primeira resposta costuma sair em ${estimativa.label}.`
                    : 'Quem vai atender o chamado.'}
                </span>
              )}
              {erroDe('team_id')}
            </Campo>

            {/* Sem `ticket.edit_properties` o campo some — não fica desabilitado
                mostrando "Sem responsável" (que não é um valor fixo do
                ticket, é só decoração: o ticket ainda nem existe). Mesma
                permissão do painel do ticket aberto (../detalhe/
                PainelPropriedades.tsx: `podeEditar`). */}
            {podeEditarPropriedades && (
              <Campo
                rotulo="Responsável"
                htmlFor={ids.resp}
                acao={
                  me?.is_internal ? (
                    <button
                      type="button"
                      className="props__link"
                      onClick={() => setResponsavelId(String(me.id))}
                      disabled={responsavelId === String(me.id)}
                    >
                      Atribuir para mim
                    </button>
                  ) : undefined
                }
              >
                <SeletorCampo
                  id={ids.resp}
                  icone="ti ti-headset"
                  valor={responsavelId}
                  onChange={setResponsavelId}
                  desabilitado={agentes == null}
                  descrito={`${ids.resp}-ajuda`}
                >
                  <option value="">{agentes ? 'Sem responsável' : 'Carregando…'}</option>
                  {(agentes ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name}
                    </option>
                  ))}
                </SeletorCampo>
                <span className="props__ajuda" id={`${ids.resp}-ajuda`}>
                  Pode ficar para a triagem.
                </span>
              </Campo>
            )}
          </section>

          <section className="props__grupo">
            <h2 className="props__titulo">Classificação</h2>

            <Campo rotulo="Prioridade" htmlFor={ids.prio}>
              <SeletorCampo
                id={ids.prio}
                cor={COR_PRIORIDADE[prioridade]}
                valor={prioridade}
                onChange={(v) => setPrioridade(v as Prioridade)}
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {ROTULO_PRIORIDADE[p]}
                  </option>
                ))}
              </SeletorCampo>
            </Campo>

            {temServicos && (
              <Campo rotulo="Serviço" htmlFor={ids.servico}>
                <SeletorCampo
                  id={ids.servico}
                  icone="ti ti-briefcase"
                  valor={servicoId}
                  onChange={trocarServico}
                  descrito={`${ids.servico}-ajuda`}
                >
                  <option value="">Todos os serviços</option>
                  {(servicos ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </SeletorCampo>
                <span className="props__ajuda" id={`${ids.servico}-ajuda`}>
                  Filtra as categorias abaixo.
                </span>
              </Campo>
            )}

            <Campo rotulo="Categoria" htmlFor={ids.cat}>
              <SeletorCampo
                id={ids.cat}
                icone="ti ti-tag"
                valor={categoriaId}
                onChange={(v) => {
                  setCategoriaId(v)
                  limparErro('category_id')
                }}
                // Categoria é OPCIONAL: se a lista falhou, a pessoa ainda
                // segue com "Sem categoria" em vez de ficar travada num
                // seletor desabilitado (`categorias == null` sozinho não
                // distinguia "carregando" de "falhou" — o mesmo bug do
                // <select> de Equipe, só que sem bloquear o envio).
                desabilitado={categorias == null && !falhouCategorias}
                invalido={Boolean(erros.category_id)}
                descrito={descreve('category_id', `${ids.cat}-ajuda`)}
              >
                <option value="">
                  {categorias != null || falhouCategorias ? 'Sem categoria' : 'Carregando…'}
                </option>
                {categoriasDoServico.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SeletorCampo>
              {falhouCategorias ? (
                <ErroConsulta
                  id={`${ids.cat}-ajuda`}
                  mensagem="Não foi possível carregar as categorias."
                  aoTentar={() => recarregarCategorias()}
                />
              ) : (
                <span className="props__ajuda" id={`${ids.cat}-ajuda`}>
                  A triagem pode classificar depois.
                </span>
              )}
              {erroDe('category_id')}
            </Campo>

            {temEtiquetas && podeEditarPropriedades && (
              <Campo rotulo="Etiquetas">
                <ul className="props__chips" aria-label="Etiquetas">
                  {(etiquetas ?? []).map((t) => {
                    const ligada = tagIds.includes(t.id)
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          className={
                            'props__chip novo__chip' + (ligada ? ' novo__chip--ligada' : '')
                          }
                          aria-pressed={ligada}
                          onClick={() => alternarEtiqueta(t.id)}
                        >
                          {t.color && (
                            <span
                              className="props__cor"
                              style={{ background: t.color }}
                              aria-hidden="true"
                            />
                          )}
                          {t.name}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </Campo>
            )}
          </section>

          <section className="props__grupo">
            <h2 className="props__titulo">Referência</h2>
            <Campo rotulo="Nº do pedido" htmlFor={ids.pedido}>
              <input
                id={ids.pedido}
                className="novo__input"
                type="text"
                maxLength={40}
                value={numeroPedido}
                aria-invalid={erros.order_number ? true : undefined}
                aria-describedby={descreve('order_number', `${ids.pedido}-ajuda`)}
                onChange={(e) => {
                  setNumeroPedido(e.target.value)
                  limparErro('order_number')
                }}
              />
              <span className="props__ajuda" id={`${ids.pedido}-ajuda`}>
                Sem formato fixo — cada loja numera do seu jeito.
              </span>
              {erroDe('order_number')}
            </Campo>
          </section>
        </aside>

        {/* ---------------- a mensagem: o que o cliente vai ler ---------------- */}
        <section className="novo__compor" aria-label="Redação do chamado">
          {erroGeral && (
            <p className="compositor__erro" role="alert">
              <i className="ti ti-alert-circle" aria-hidden="true" /> {erroGeral}
            </p>
          )}
          {avisoRascunho && (
            <p className="compositor__aviso novo__rascunho" role="status">
              <i className="ti ti-history" aria-hidden="true" />
              <span>
                Recuperamos o chamado que você tinha começado a escrever aqui.
                {rascunhoSalvo?.anexos.length
                  ? ` Os anexos (${rascunhoSalvo.anexos.join(', ')}) precisam ser escolhidos de novo.`
                  : ''}{' '}
                <button type="button" className="novo__link" onClick={descartarRascunho}>
                  Descartar rascunho
                </button>
              </span>
              <button
                type="button"
                className="novo__fechar"
                aria-label="Fechar o aviso de rascunho"
                onClick={() => setAvisoRascunho(false)}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </p>
          )}

          <div className="novo__bloco">
            <div className="novo__rotulo-linha">
              <label className="novo__rotulo" htmlFor={ids.para}>
                Para <Obrigatorio />
              </label>
              {(empresas?.length ?? 0) > 1 && (
                <span className="novo__filtro">
                  <label htmlFor={ids.empresa}>Empresa</label>
                  <select
                    id={ids.empresa}
                    value={empresaId == null ? '' : String(empresaId)}
                    onChange={(e) => trocarEmpresa(e.target.value)}
                  >
                    <option value="">Todas</option>
                    {(empresas ?? []).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </div>
            <BuscaPessoa
              ref={paraRef}
              id={ids.para}
              opcoes={pessoas}
              valor={solicitanteIdValido}
              onChange={escolherSolicitante}
              aoMudarTermo={setTermoSolicitante}
              carregando={carregandoSolicitantes}
              placeholder="Nome ou e-mail do cliente"
              invalido={Boolean(erros.requester_id)}
              describedBy={descreve('requester_id', `${ids.para}-ajuda`)}
              vazio={
                !podeBuscarSolicitante
                  ? `Digite ao menos ${MINIMO_PARA_BUSCAR} letras para buscar.`
                  : empresaId != null
                    ? 'Ninguém com esse nome nesta empresa.'
                    : 'Ninguém com esse nome ou e-mail.'
              }
              // BuscaPessoa troca sozinho o "Ninguém encontrado" (falso,
              // aqui seria falha de rede) por um erro de verdade com retry.
              erro={falhouBuscaSolicitantes}
              aoTentarDeNovo={() => refazerBuscaSolicitantes()}
            />
            {solicitante ? (
              <div className="novo__cliente" id={`${ids.para}-ajuda`}>
                <span className="cliente__avatar" aria-hidden="true" {...identidadeDe(solicitante.full_name)}>
                  {iniciais(solicitante.full_name)}
                </span>
                <span className="novo__cliente-id">
                  <span className="novo__cliente-nome">{solicitante.full_name}</span>
                  <span className="novo__cliente-meta">
                    {[solicitante.email, empresaDoSolicitante?.name].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="novo__cliente-quota">
                  <i className="ti ti-shield-check" aria-hidden="true" />
                  {empresaDoSolicitante?.plan_name
                    ? `Plano ${empresaDoSolicitante.plan_name} · `
                    : ''}
                  aberto por você, não consome a cota
                </span>
              </div>
            ) : falhouBuscaSolicitantes ? (
              <ErroConsulta
                id={`${ids.para}-ajuda`}
                mensagem="Não foi possível carregar os clientes."
                aoTentar={() => refazerBuscaSolicitantes()}
              />
            ) : (
              <span className="props__ajuda" id={`${ids.para}-ajuda`}>
                O cliente em nome de quem o chamado é aberto. Ele recebe a mensagem abaixo por
                e-mail.
              </span>
            )}
            {erroDe('requester_id')}
            {/* Aviso de possível duplicata — nunca bloqueia o envio (por isso
                não é `erroDe`/`role="alert"`): quem liga de novo ou manda
                e-mail depois de já ter aberto pelo portal é o caso comum, mas
                a decisão de abrir mesmo assim é do agente. Só aparece com
                empresa vinculada e ALGUM chamado aberto — 0 fica em silêncio
                (é o estado normal, não precisa de aviso nenhum). */}
            {solicitante && (chamadosAbertos?.count ?? 0) > 0 && (
              <p className="novo__duplicidade" id={`${ids.para}-duplicidade`} role="status">
                <i className="ti ti-alert-triangle" aria-hidden="true" />
                <span>
                  {solicitante.full_name} já tem {chamadosAbertos!.count}{' '}
                  {chamadosAbertos!.count === 1 ? 'chamado aberto' : 'chamados abertos'} que você
                  enxerga:{' '}
                  {chamadosAbertos!.results.map((t, i) => (
                    <span key={t.id}>
                      {i > 0 && ', '}
                      <a
                        className="novo__link"
                        href={`/chamados/${t.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t.reference}
                      </a>
                    </span>
                  ))}
                  {chamadosAbertos!.count > chamadosAbertos!.results.length &&
                    ` e mais ${chamadosAbertos!.count - chamadosAbertos!.results.length}`}
                  .
                </span>
              </p>
            )}
          </div>

          <div className="novo__bloco">
            <label className="novo__rotulo" htmlFor={ids.assunto}>
              Assunto <Obrigatorio />
            </label>
            <input
              id={ids.assunto}
              className="novo__assunto"
              type="text"
              maxLength={200}
              placeholder="Resuma o chamado em uma linha"
              value={assunto}
              aria-invalid={erros.subject ? true : undefined}
              aria-describedby={descreve('subject')}
              onChange={(e) => {
                setAssunto(e.target.value)
                limparErro('subject')
              }}
            />
            {erroDe('subject')}
          </div>

          <div className="novo__bloco novo__bloco--mensagem">
            <div className="novo__rotulo-linha">
              <label className="novo__rotulo" htmlFor={ids.texto}>
                Mensagem <Obrigatorio />
              </label>
              <span className="novo__dica" id={`${ids.texto}-ajuda`}>
                Vira a primeira mensagem do chamado, visível para o cliente.
              </span>
            </div>
            <textarea
              id={ids.texto}
              className="compositor__texto novo__texto"
              placeholder="Conte o que aconteceu, o que já foi tentado e o que o cliente precisa…"
              rows={10}
              value={texto}
              aria-invalid={erros.body ? true : undefined}
              aria-describedby={descreve('body', `${ids.texto}-ajuda`)}
              onChange={(e) => {
                setTexto(e.target.value)
                limparErro('body')
              }}
            />
            {erroDe('body')}

            {anexos.length > 0 && (
              <ul className="compositor__anexos" aria-label="Anexos a enviar">
                {anexos.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="compositor__anexo">
                    <i className="ti ti-paperclip" aria-hidden="true" />
                    <span className="compositor__anexo-nome">{f.name}</span>
                    <span className="compositor__anexo-tam">{tamanhoArquivo(f.size)}</span>
                    <button
                      type="button"
                      aria-label={`Remover ${f.name}`}
                      onClick={() => {
                        setAnexos((a) => a.filter((_, j) => j !== i))
                        limparErro('files')
                      }}
                    >
                      <i className="ti ti-x" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {erroDe('files')}

            {assinatura && (
              <div className="novo__assinatura">
                <label className="novo__assinatura-toggle">
                  <input
                    type="checkbox"
                    checked={assinaturaLigada}
                    onChange={(e) => setAssinaturaLigada(e.target.checked)}
                  />
                  Incluir minha assinatura
                </label>
                {assinaturaLigada && <pre className="novo__assinatura-previa">{assinatura}</pre>}
              </div>
            )}

            {aviso && (
              <p className="compositor__aviso" role="status">
                <i className="ti ti-bolt" aria-hidden="true" /> {aviso}
              </p>
            )}

            <div className="compositor__rodape novo__rodape">
              <div className="compositor__ferramentas">
                <button
                  id={ids.anexar}
                  type="button"
                  className="compositor__ferramenta"
                  onClick={() => inputAnexo.current?.click()}
                  disabled={limites != null && anexos.length >= limites.maxArquivos}
                  aria-describedby={descreve('files', `${ids.anexar}-ajuda`)}
                >
                  <i className="ti ti-paperclip" aria-hidden="true" /> Anexar
                </button>
                <input
                  ref={inputAnexo}
                  type="file"
                  multiple
                  hidden
                  accept={TIPOS_ACEITOS}
                  aria-label="Escolher arquivos para anexar"
                  onChange={(e) => {
                    adicionarAnexos(e.target.files)
                    e.target.value = '' // permite escolher o mesmo arquivo de novo
                  }}
                />

                {(macros?.length ?? 0) > 0 && (
                  <div className="compositor__macro" ref={menuRef}>
                    <button
                      type="button"
                      className={
                        'compositor__ferramenta' +
                        (menuMacro ? ' compositor__ferramenta--ativa' : '')
                      }
                      aria-haspopup="menu"
                      aria-expanded={menuMacro}
                      onClick={() => setMenuMacro((v) => !v)}
                    >
                      <i className="ti ti-bolt" aria-hidden="true" /> Aplicar macro…
                    </button>
                    {menuMacro && (
                      <ul className="compositor__macro-menu" role="menu" aria-label="Macros">
                        {(macros ?? []).map((m) => (
                          <li key={m.id} role="none">
                            <button type="button" role="menuitem" onClick={() => usarMacro(m)}>
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
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <span className="novo__dica novo__dica--anexo" id={`${ids.anexar}-ajuda`}>
                  {limites
                    ? `Até ${limites.maxMb} MB por arquivo e ${limites.maxArquivos} arquivos · imagem, PDF, texto, planilha, zip`
                    : 'Imagem, PDF, texto, planilha, zip · o limite de tamanho vem da configuração do sistema'}
                </span>
              </div>

              <div className="compositor__enviar">
                <button
                  type="button"
                  className="novo__cancelar"
                  onClick={cancelar}
                  disabled={abrir.isPending}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="compositor__botao"
                  onClick={() => void enviar()}
                  disabled={abrir.isPending}
                  title="Ctrl+Enter"
                >
                  {abrir.isPending ? 'Abrindo…' : 'Abrir chamado'}
                  <kbd aria-hidden="true">⌃↵</kbd>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
