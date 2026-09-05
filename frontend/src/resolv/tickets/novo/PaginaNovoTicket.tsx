import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import {
  useAbrirTicket,
  useAgentes,
  useCategorias,
  useClientes,
  useEmpresasOpcoes,
  useEquipes,
  useEstimativaResposta,
  useEtiquetas,
  useServicos,
} from '@/cvz/tickets/dados'
import { COR_PRIORIDADE, ROTULO_PRIORIDADE } from '../format'
import type { Prioridade } from '../tipos'
import { useMacros } from '../detalhe/dados'
import { Campo, Seletor } from '../detalhe/PainelPropriedades'
import {
  iniciais,
  interpolarMacro,
  marcadoresPendentes,
  mensagemDeErro,
  tamanhoArquivo,
} from '../detalhe/linhaDoTempo'
import type { Macro } from '../detalhe/tiposDetalhe'
import { BuscaPessoa } from './BuscaPessoa'
// A tela é "o detalhe antes de o ticket existir": mesmas colunas, mesmos
// controles (.props, .compositor, .ticket-cab) — importa a folha do detalhe
// e só acrescenta o que é próprio da abertura em novo.scss.
import '../detalhe/detalhe.scss'
import './novo.scss'

const PRIORIDADES: Prioridade[] = ['low', 'normal', 'high', 'urgent']

/** Limites do backend (ATTACHMENT_MAX_BYTES / _FILES_PER_MESSAGE). Conferir
 *  aqui só evita subir um arquivo que seria recusado depois. */
const MAX_MB = 20
const MAX_ARQUIVOS = 10
/** Mesma allowlist de `ATTACHMENT_ALLOWED_MIME` — para o `accept` do seletor
 *  e um aviso cedo. Quem decide é o backend, por magic bytes. */
const TIPOS_ACEITOS =
  'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,application/zip,.docx,.xlsx,.pptx'

/** Separa o que a pessoa escreveu da assinatura — e permite validar só o
 *  texto (a assinatura sozinha não conta como "mensagem preenchida"). */
const SEP_ASSINATURA = '\n\n--\n'

type NomeCampo =
  | 'requester_id'
  | 'team_id'
  | 'subject'
  | 'body'
  | 'files'
  | 'category_id'
  | 'order_number'

/** Ordem em que os campos aparecem na tela — o foco vai para o PRIMEIRO
 *  inválido nessa ordem (WCAG 3.3.1: erro identificado e alcançável). */
const ORDEM_FOCO: NomeCampo[] = ['team_id', 'requester_id', 'subject', 'body']

function Obrigatorio() {
  return (
    <abbr className="novo__obrig" title="obrigatório">
      *
    </abbr>
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
 *  - Ctrl+Enter abre o chamado; sair com texto escrito pede confirmação.
 */
export function PaginaNovoTicket() {
  const navigate = useNavigate()
  const idBase = useId()
  const { data: me } = useMe()

  const { data: equipes } = useEquipes()
  const { data: servicos } = useServicos()
  const { data: categorias } = useCategorias()
  const { data: empresas } = useEmpresasOpcoes()
  const { data: agentes } = useAgentes()
  const { data: etiquetas } = useEtiquetas()
  const { data: macros } = useMacros()

  const [empresaId, setEmpresaId] = useState<number | null>(null)
  const [solicitanteId, setSolicitanteId] = useState<number | null>(null)
  const [equipeId, setEquipeId] = useState('')
  const [assunto, setAssunto] = useState('')
  const [texto, setTexto] = useState('')
  const [prioridade, setPrioridade] = useState<Prioridade>('normal')
  const [servicoId, setServicoId] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [numeroPedido, setNumeroPedido] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [tagIds, setTagIds] = useState<number[]>([])
  const [anexos, setAnexos] = useState<File[]>([])
  const [assinaturaLigada, setAssinaturaLigada] = useState(true)
  const [erros, setErros] = useState<Partial<Record<NomeCampo, string>>>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [menuMacro, setMenuMacro] = useState(false)
  /** Chamado criado, mas responsável/etiquetas não colaram: fica na tela
   *  com o chamado a um clique, em vez de sumir com o aviso. */
  const [pendencia, setPendencia] = useState<{ id: number; referencia: string; itens: string[] } | null>(
    null,
  )

  const { data: clientes, isLoading: carregandoClientes } = useClientes(empresaId)
  const abrir = useAbrirTicket()

  const paraRef = useRef<HTMLInputElement>(null)
  const inputAnexo = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
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
  }
  const idDoCampo: Record<NomeCampo, string> = {
    team_id: ids.equipe,
    requester_id: ids.para,
    subject: ids.assunto,
    body: ids.texto,
    files: ids.texto,
    category_id: ids.cat,
    order_number: ids.pedido,
  }

  // A tela abre com o foco em "Para": é o primeiro campo da tarefa
  // principal (escrever para alguém), e evita sete tabs pelo painel de
  // triagem antes de começar.
  useEffect(() => {
    paraRef.current?.focus()
  }, [])

  // Sair com texto escrito (fechar aba, F5) pede confirmação — o navegador
  // mostra o diálogo dele. Depois de aberto o chamado, não.
  const sujo = Boolean(assunto.trim() || texto.trim() || solicitanteId != null || anexos.length)
  useEffect(() => {
    if (!sujo) return
    const h = (e: BeforeUnloadEvent) => {
      if (enviadoRef.current) return
      e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [sujo])

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

  const equipeEscolhida = equipesDisponiveis.find((e) => String(e.id) === equipeId)
  const { data: estimativa } = useEstimativaResposta(equipeEscolhida?.slug ?? null)

  const empresaPorId = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e])), [empresas])
  const nomeEmpresa = (id: number | null | undefined) =>
    id != null ? (empresaPorId.get(id)?.name ?? '') : ''

  const pessoas = useMemo(
    () =>
      (clientes ?? []).map((c) => ({
        id: c.id,
        nome: c.full_name,
        descricao: [c.email, nomeEmpresa(c.company)].filter(Boolean).join(' · '),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientes, empresaPorId],
  )
  const solicitante = (clientes ?? []).find((c) => c.id === solicitanteId) ?? null
  const empresaDoSolicitante = solicitante ? empresaPorId.get(solicitante.company ?? -1) : undefined

  /** Categoria depende do serviço — o filtro é do frontend por decisão do
   *  backend (ServiceSerializer). Sem serviço escolhido, oferece todas. */
  const categoriasDoServico = useMemo(() => {
    if (!categorias) return []
    if (!servicoId) return categorias
    return categorias.filter((c) => c.service === Number(servicoId))
  }, [categorias, servicoId])
  const temServicos = (servicos?.length ?? 0) > 0
  const temEtiquetas = (etiquetas?.length ?? 0) > 0

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
  }

  function escolherSolicitante(id: number | null) {
    setSolicitanteId(id)
    limparErro('requester_id')
    // macro aplicada antes de escolher a pessoa deixou marcadores no texto:
    // agora dá para preenchê-los — só eles, nunca o que o agente digitou
    const c = id != null ? (clientes ?? []).find((x) => x.id === id) : undefined
    if (c) {
      setTexto((atual) =>
        marcadoresPendentes(atual).length
          ? interpolarMacro(atual, {
              solicitante: c.full_name,
              empresa: nomeEmpresa(c.company) || undefined,
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

  function adicionarAnexos(lista: FileList | null) {
    if (!lista) return
    const novos = Array.from(lista)
    const grandes = novos.filter((f) => f.size > MAX_MB * 1024 * 1024)
    const aceitos = novos.filter((f) => f.size <= MAX_MB * 1024 * 1024)
    const total = anexos.length + aceitos.length
    const problemas: string[] = []
    if (grandes.length) {
      problemas.push(
        `${grandes.map((f) => f.name).join(', ')}: acima de ${MAX_MB} MB — não foi adicionado.`,
      )
    }
    if (total > MAX_ARQUIVOS) {
      problemas.push(`No máximo ${MAX_ARQUIVOS} arquivos por mensagem.`)
    }
    setAnexos((a) => [...a, ...aceitos].slice(0, MAX_ARQUIVOS))
    if (problemas.length) setErros((e) => ({ ...e, files: problemas.join(' ') }))
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
      empresa: nomeEmpresa(solicitante?.company) || undefined,
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
    if (solicitanteId == null) e.requester_id = 'Escolha para quem o chamado é aberto.'
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

  async function enviar() {
    if (abrir.isPending) return
    setErroGeral(null)
    const invalidos = validar()
    if (Object.keys(invalidos).length) {
      setErros((atuais) => ({ ...atuais, ...invalidos }))
      focarPrimeiroInvalido(invalidos)
      return
    }

    const corpo =
      assinaturaLigada && assinatura ? `${texto.trim()}${SEP_ASSINATURA}${assinatura}` : texto.trim()

    try {
      const { ticket, pendencias } = await abrir.mutateAsync({
        team_id: Number(equipeId),
        subject: assunto.trim(),
        body: corpo,
        priority: prioridade,
        requester_id: solicitanteId!,
        category_id: categoriaId ? Number(categoriaId) : null,
        order_number: numeroPedido.trim(),
        arquivos: anexos,
        assignee_id: responsavelId ? Number(responsavelId) : null,
        tag_ids: tagIds,
      })
      enviadoRef.current = true
      if (pendencias.length) {
        setPendencia({ id: ticket.id, referencia: ticket.reference, itens: pendencias })
        return
      }
      navigate(`/chamados/${ticket.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) {
        const porCampo = Object.fromEntries(
          Object.entries(e.fieldErrors).map(([campo, msgs]) => [campo, msgs[0]]),
        ) as Partial<Record<NomeCampo, string>>
        setErros((atuais) => ({ ...atuais, ...porCampo }))
        focarPrimeiroInvalido(porCampo)
        if (e.detail) setErroGeral(e.detail)
      } else {
        setErroGeral(`${mensagemDeErro(e, 'Não foi possível abrir o chamado.')} Nada foi perdido — o texto continua aqui.`)
      }
    }
  }

  function cancelar() {
    if (sujo && !window.confirm('Descartar o chamado que você começou a escrever?')) return
    enviadoRef.current = true
    navigate('/chamados')
  }

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void enviar()
    }
  }

  const descreve = (campo: NomeCampo, ajuda?: string) =>
    [ajuda, erros[campo] ? `${idDoCampo[campo]}-erro` : undefined].filter(Boolean).join(' ') || undefined

  // função, não componente: declarar um componente aqui dentro o remontaria
  // a cada render (e o lint do React recusa)
  const erroDe = (campo: NomeCampo) =>
    erros[campo] ? (
      <span id={`${idDoCampo[campo]}-erro`} className="novo__erro" role="alert">
        <i className="ti ti-alert-circle" aria-hidden="true" /> {erros[campo]}
      </span>
    ) : null

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
              <span className={erros.team_id ? 'novo__invalido' : undefined}>
                <Seletor
                  id={ids.equipe}
                  icone="ti ti-users-group"
                  value={equipeId}
                  onChange={(v) => {
                    setEquipeId(v)
                    limparErro('team_id')
                  }}
                  disabled={equipes == null}
                >
                  <option value="">{equipes ? 'Selecione a equipe' : 'Carregando…'}</option>
                  {equipesDisponiveis.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Seletor>
              </span>
              <span className="props__ajuda" id={`${ids.equipe}-ajuda`}>
                {semEquipe
                  ? 'Você não atende nenhuma equipe — a abertura fica com quem atende.'
                  : estimativa?.label
                    ? `Primeira resposta costuma sair em ${estimativa.label}.`
                    : 'Quem vai atender o chamado.'}
              </span>
              {erroDe('team_id')}
            </Campo>

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
              <Seletor
                id={ids.resp}
                icone="ti ti-headset"
                value={responsavelId}
                onChange={setResponsavelId}
                disabled={agentes == null}
              >
                <option value="">{agentes ? 'Sem responsável' : 'Carregando…'}</option>
                {(agentes ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}
                  </option>
                ))}
              </Seletor>
              <span className="props__ajuda">Pode ficar para a triagem.</span>
            </Campo>
          </section>

          <section className="props__grupo">
            <h2 className="props__titulo">Classificação</h2>

            <Campo rotulo="Urgência" htmlFor={ids.prio}>
              <Seletor
                id={ids.prio}
                cor={COR_PRIORIDADE[prioridade]}
                value={prioridade}
                onChange={(v) => setPrioridade(v as Prioridade)}
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {ROTULO_PRIORIDADE[p]}
                  </option>
                ))}
              </Seletor>
            </Campo>

            {temServicos && (
              <Campo rotulo="Serviço" htmlFor={ids.servico}>
                <Seletor id={ids.servico} icone="ti ti-briefcase" value={servicoId} onChange={trocarServico}>
                  <option value="">Todos os serviços</option>
                  {(servicos ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Seletor>
                <span className="props__ajuda">Filtra as categorias abaixo.</span>
              </Campo>
            )}

            <Campo rotulo="Categoria" htmlFor={ids.cat}>
              <Seletor
                id={ids.cat}
                icone="ti ti-tag"
                value={categoriaId}
                onChange={(v) => {
                  setCategoriaId(v)
                  limparErro('category_id')
                }}
                disabled={categorias == null}
              >
                <option value="">{categorias ? 'Sem categoria' : 'Carregando…'}</option>
                {categoriasDoServico.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Seletor>
              <span className="props__ajuda">A triagem pode classificar depois.</span>
              {erroDe('category_id')}
            </Campo>

            {temEtiquetas && (
              <Campo rotulo="Etiquetas">
                <ul className="props__chips" aria-label="Etiquetas">
                  {(etiquetas ?? []).map((t) => {
                    const ligada = tagIds.includes(t.id)
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          className={'props__chip novo__chip' + (ligada ? ' novo__chip--ligada' : '')}
                          aria-pressed={ligada}
                          onClick={() => alternarEtiqueta(t.id)}
                        >
                          {t.color && (
                            <span className="props__cor" style={{ background: t.color }} aria-hidden="true" />
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
          {pendencia && (
            <p className="compositor__aviso novo__pendencia" role="status">
              <i className="ti ti-circle-check" aria-hidden="true" />
              <span>
                <strong>{pendencia.referencia}</strong> foi aberto, mas {pendencia.itens.join(' e ')} — dá para
                ajustar no próprio chamado.{' '}
                <button type="button" className="novo__link" onClick={() => navigate(`/chamados/${pendencia.id}`)}>
                  Abrir {pendencia.referencia}
                </button>
              </span>
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
              valor={solicitanteId}
              onChange={escolherSolicitante}
              carregando={carregandoClientes}
              placeholder="Nome ou e-mail do cliente"
              invalido={Boolean(erros.requester_id)}
              describedBy={descreve('requester_id', `${ids.para}-ajuda`)}
              vazio={empresaId != null ? 'Ninguém com esse nome nesta empresa.' : 'Ninguém com esse nome ou e-mail.'}
            />
            {solicitante ? (
              <div className="novo__cliente" id={`${ids.para}-ajuda`}>
                <span className="cliente__avatar" aria-hidden="true">
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
                  {empresaDoSolicitante?.plan_name ? `Plano ${empresaDoSolicitante.plan_name} · ` : ''}
                  aberto por você, não consome a cota
                </span>
              </div>
            ) : (
              <span className="props__ajuda" id={`${ids.para}-ajuda`}>
                O cliente em nome de quem o chamado é aberto. Ele recebe a mensagem abaixo por e-mail.
              </span>
            )}
            {erroDe('requester_id')}
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
                      onClick={() => setAnexos((a) => a.filter((_, j) => j !== i))}
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
                  type="button"
                  className="compositor__ferramenta"
                  onClick={() => inputAnexo.current?.click()}
                  disabled={anexos.length >= MAX_ARQUIVOS}
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
                      className={'compositor__ferramenta' + (menuMacro ? ' compositor__ferramenta--ativa' : '')}
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
                                <span className="compositor__macro-previa">{m.body.split('\n')[0]}</span>
                              )}
                              {(m.category_name || m.priority || m.assignee_name) && (
                                <span className="compositor__macro-triagem">
                                  {[
                                    m.category_name && `categoria → ${m.category_name}`,
                                    m.priority && `urgência → ${ROTULO_PRIORIDADE[m.priority] ?? m.priority}`,
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
                <span className="novo__dica novo__dica--anexo">
                  Até {MAX_MB} MB por arquivo · imagem, PDF, texto, planilha, zip
                </span>
              </div>

              <div className="compositor__enviar">
                <button type="button" className="novo__cancelar" onClick={cancelar} disabled={abrir.isPending}>
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
