import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
// Tudo do barrel — DESIGN.md: "Importe sempre de src/components, nunca do
// caminho profundo" (vale para ícones e para useToast também). O catálogo de
// ícones do cvzdesk é fechado e não tem headset (o da referência antiga);
// IconTicket é o do próprio sistema para chamado — melhor que inventar um
// ícone fora do conjunto.
import {
  Button,
  Checkbox,
  Combobox,
  Field,
  FileUpload,
  IconBold,
  IconItalic,
  IconLink,
  IconList,
  IconPaperclip,
  IconTicket,
  IconZap,
  Notification,
  Popover,
  Select,
  Tag,
  TextInput,
  Tooltip,
  useToast,
} from '@/cvz/components'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import {
  PRIORIDADES,
  useAbrirTicket,
  useAgentes,
  useCategorias,
  useClientes,
  useEmpresasOpcoes,
  useEquipes,
  useEstimativaResposta,
  useEtiquetas,
  useMacrosTicket,
  useServicos,
  type MacroTicket,
  type Prioridade,
} from './dados'
import './novo-ticket.scss'

/** Limite por arquivo. O backend tem o dele (antivírus + tamanho); este aqui
 *  só evita a subida inútil de um arquivo que seria recusado depois. */
const MAX_MB = 20

/** Separador entre o texto escrito e a assinatura do agente. Serve para dois
 *  fins: separar visualmente e permitir validar só o que foi realmente escrito
 *  (senão a assinatura sozinha passaria como "descrição preenchida"). */
const SEP_ASSINATURA = '\n\n--\n'

/**
 * As macros de ticket vêm com marcadores `{{solicitante}}`, `{{empresa}}` e
 * `{{referencia}}` no corpo — e NINGUÉM os substitui no servidor. O
 * `apply_macro` nem grava o corpo (é decisão explícita do backend que o texto
 * é responsabilidade do front), e a única interpolação que existe em todo o
 * projeto é a do chat, para outra chave (`chat_service.render_welcome`).
 *
 * Sem tratar isso aqui, o cliente receberia "Olá, {{solicitante}}!" ao pé da
 * letra. Então: troca o que dá para trocar, e o que sobrar vira trava no envio.
 */
const MARCADOR = /\{\{\s*(\w+)\s*\}\}/g

/** Mesma convenção do chat (`render_welcome`): só o primeiro nome. */
function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? ''
}

function interpolar(texto: string, ctx: { solicitante?: string; empresa?: string }): string {
  return texto.replace(MARCADOR, (original, chave: string) => {
    if (chave === 'solicitante' && ctx.solicitante) return primeiroNome(ctx.solicitante)
    if (chave === 'empresa' && ctx.empresa) return ctx.empresa
    // `referencia` não existe antes de o chamado ser criado, e chave
    // desconhecida não é nossa para adivinhar: fica visível para a pessoa
    // resolver, e a validação do envio não deixa passar.
    return original
  })
}

function marcadoresPendentes(texto: string): string[] {
  return [...new Set(texto.match(MARCADOR) ?? [])]
}

export function PaginaNovoTicket() {
  const navigate = useNavigate()
  const { push } = useToast()
  const { data: me } = useMe()

  const { data: equipes } = useEquipes()
  const { data: servicos } = useServicos()
  const { data: categorias } = useCategorias()
  const { data: empresas } = useEmpresasOpcoes()
  const { data: agentes } = useAgentes()
  const { data: etiquetas } = useEtiquetas()
  const { data: macros } = useMacrosTicket()

  const [empresaId, setEmpresaId] = useState<number | null>(null)
  const [solicitanteId, setSolicitanteId] = useState<string | null>(null)
  const [equipeId, setEquipeId] = useState('')
  const [assunto, setAssunto] = useState('')
  const [descricao, setDescricao] = useState('')
  const [prioridade, setPrioridade] = useState<Prioridade>('normal')
  const [servicoId, setServicoId] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [numeroPedido, setNumeroPedido] = useState('')
  const [responsavelId, setResponsavelId] = useState<string | null>(null)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [arquivos, setArquivos] = useState<File[]>([])
  const [mostrarAnexos, setMostrarAnexos] = useState(false)
  const [assinaturaLigada, setAssinaturaLigada] = useState(true)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [errosCampo, setErrosCampo] = useState<Record<string, string>>({})
  /** Chamado criado, mas alguma etapa pós-criação falhou. */
  const [pendencia, setPendencia] = useState<{
    referencia: string
    id: number
    itens: string[]
  } | null>(null)

  const { data: clientes, isLoading: carregandoClientes } = useClientes(empresaId)
  const abrir = useAbrirTicket()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const assinatura = (me?.signature ?? '').trim()
  const contagemPalavras = descricao.trim() ? descricao.trim().split(/\s+/).length : 0

  /** Envolve a seleção com marcação (negrito/itálico) — mesma lógica do
   *  ReplyEditor do cvzdesk, adaptada para este textarea próprio (o `TextArea`
   *  do barrel não expõe ref). */
  function envolverSelecao(antes: string, depois = antes) {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const novo = descricao.slice(0, s) + antes + descricao.slice(s, e) + depois + descricao.slice(e)
    setDescricao(novo)
    limparErro('body')
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(s + antes.length, e + antes.length)
    })
  }

  function inserirPrefixoDeLinha(prefixo: string) {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: s } = el
    const inicioLinha = descricao.lastIndexOf('\n', s - 1) + 1
    setDescricao(descricao.slice(0, inicioLinha) + prefixo + descricao.slice(inicioLinha))
    limparErro('body')
    requestAnimationFrame(() => el.focus())
  }

  function aoTeclarNoEditor(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault()
      envolverSelecao('**')
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault()
      envolverSelecao('_')
    }
  }

  /**
   * Um agente só abre chamado nas equipes que ATENDE — a regra é do backend
   * (ticket_service.create_ticket levanta TicketRuleViolation), e `me.teams`
   * traz exatamente os slugs dessas equipes. Filtrar aqui não é a autorização:
   * é não oferecer uma opção que sempre voltaria erro. Admin não tem recorte.
   */
  const equipesDisponiveis = useMemo(() => {
    if (!equipes) return []
    if (me?.is_admin) return equipes
    const minhas = new Set(me?.teams ?? [])
    return equipes.filter((e) => minhas.has(e.slug))
  }, [equipes, me])

  const equipeEscolhida = equipesDisponiveis.find((e) => String(e.id) === equipeId)
  const { data: estimativa } = useEstimativaResposta(equipeEscolhida?.slug ?? null)

  const nomeEmpresa = useMemo(() => {
    const porId = new Map((empresas ?? []).map((e) => [e.id, e.name]))
    return (id: number | null) => (id != null ? (porId.get(id) ?? '') : '')
  }, [empresas])

  const opcoesSolicitante = useMemo(
    () =>
      (clientes ?? []).map((c) => ({
        value: String(c.id),
        label: c.full_name,
        // a busca do Combobox só olha o `label`; e-mail e empresa ficam aqui
        // como desempate visual entre dois homônimos
        description: [c.email, nomeEmpresa(c.company)].filter(Boolean).join(' · '),
      })),
    [clientes, nomeEmpresa],
  )

  const opcoesAgente = useMemo(
    () => (agentes ?? []).map((a) => ({ value: String(a.id), label: a.full_name, description: a.email })),
    [agentes],
  )

  const opcoesTags = useMemo(
    () => (etiquetas ?? []).map((t) => ({ value: String(t.id), label: t.name })),
    [etiquetas],
  )

  /** Dados do solicitante escolhido, para preencher os marcadores das macros. */
  const ctxInterpolacao = useMemo(() => {
    const c = (clientes ?? []).find((x) => String(x.id) === solicitanteId)
    return { solicitante: c?.full_name, empresa: nomeEmpresa(c?.company ?? null) || undefined }
  }, [clientes, solicitanteId, nomeEmpresa])

  /**
   * Categoria depende do serviço escolhido — o filtro é responsabilidade do
   * frontend por decisão do backend (ver `ServiceSerializer`, GAPS.md #4).
   * Sem serviço escolhido, oferece todas.
   */
  const categoriasDoServico = useMemo(() => {
    if (!categorias) return []
    if (!servicoId) return categorias
    return categorias.filter((c) => c.service === Number(servicoId))
  }, [categorias, servicoId])

  const temServicos = (servicos?.length ?? 0) > 0

  /** Some com o erro do campo assim que a pessoa mexe nele — deixar a mensagem
   *  antiga na tela depois de corrigido faz o formulário parecer travado. */
  function limparErro(campo: string) {
    setErrosCampo((atuais) => {
      if (!(campo in atuais)) return atuais
      const { [campo]: _removido, ...resto } = atuais
      return resto
    })
  }

  function trocarEmpresa(valor: string) {
    const id = valor === '' ? null : Number(valor)
    setEmpresaId(id)
    // o solicitante escolhido pode não pertencer à empresa nova — limpar é
    // mais honesto do que mandar um par empresa/pessoa que não combina
    setSolicitanteId(null)
  }

  function trocarServico(valor: string) {
    setServicoId(valor)
    // a categoria escolhida pode não pertencer ao serviço novo
    setCategoriaId('')
  }

  /**
   * Macro aplicada AQUI, no formulário, sem ida ao servidor. Não é atalho: o
   * endpoint `apply-macro` só existe para ticket já criado, e o próprio
   * backend define que o `body` da macro é responsabilidade do front
   * (ticket_service.apply_macro). Campos vazios na macro não apagam o que já
   * está preenchido — mesma regra do servidor (soma, não zera).
   */
  function aplicarMacro(m: MacroTicket) {
    if (m.body) {
      const texto = interpolar(m.body, ctxInterpolacao)
      setDescricao((atual) => (atual ? `${atual}\n${texto}` : texto))
      const pendentes = marcadoresPendentes(texto)
      if (pendentes.length) {
        push({
          tone: 'warning',
          title: 'Macro aplicada, revise o texto',
          description: `${pendentes.join(', ')} não pôde ser preenchido automaticamente.`,
        })
      } else {
        push({ tone: 'info', title: 'Macro aplicada', description: m.name })
      }
    } else {
      push({ tone: 'info', title: 'Macro aplicada', description: m.name })
    }
    if (m.category != null) setCategoriaId(String(m.category))
    if (m.priority) setPrioridade(m.priority)
    if (m.assignee != null) setResponsavelId(String(m.assignee))
    if (m.tags?.length) {
      setTagIds((atuais) => [...new Set([...atuais, ...m.tags.map(String)])])
    }
  }

  function validar(): boolean {
    const erros: Record<string, string> = {}
    if (!solicitanteId) erros.requester_id = 'Escolha quem está pedindo.'
    if (!equipeId) erros.team_id = 'Escolha a equipe que vai atender.'
    if (!assunto.trim()) erros.subject = 'Descreva o assunto em uma linha.'
    if (!descricao.trim()) {
      erros.body = 'Conte o que aconteceu.'
    } else {
      // Última barreira antes de o texto virar mensagem para o cliente: um
      // marcador que sobrou da macro chegaria ao cliente ao pé da letra.
      const pendentes = marcadoresPendentes(descricao)
      if (pendentes.length) {
        erros.body = `Troque ${pendentes.join(' e ')} pelo valor real antes de abrir — o cliente lê este texto.`
      }
    }
    setErrosCampo(erros)
    return Object.keys(erros).length === 0
  }

  async function enviar() {
    setErroGeral(null)
    if (!validar()) return

    const corpo = assinaturaLigada && assinatura
      ? `${descricao.trim()}${SEP_ASSINATURA}${assinatura}`
      : descricao.trim()

    try {
      const { ticket, pendencias } = await abrir.mutateAsync({
        team_id: Number(equipeId),
        subject: assunto.trim(),
        body: corpo,
        priority: prioridade,
        requester_id: Number(solicitanteId),
        category_id: categoriaId ? Number(categoriaId) : null,
        order_number: numeroPedido.trim(),
        arquivos,
        assignee_id: responsavelId ? Number(responsavelId) : null,
        tag_ids: tagIds.map(Number),
      })

      if (pendencias.length) {
        // Não navega: sair daqui desmonta o ToastProvider desta tela e o aviso
        // sumiria junto — e este é exatamente o aviso que a pessoa precisa
        // ler. Fica na página, com o chamado a um clique.
        setPendencia({ referencia: ticket.reference, id: ticket.id, itens: pendencias })
        return
      }

      push({
        tone: 'success',
        title: 'Chamado aberto',
        description: `${ticket.reference} — ${assunto.trim()}`,
      })
      navigate(`/chamados/${ticket.id}`)
    } catch (e) {
      if (e instanceof ApiError) {
        // erro por campo volta como {"campo": ["mensagem"]}; o resto (regra de
        // negócio, cota estourada) vem em `detail` e sobe no aviso do topo
        const porCampo = Object.fromEntries(
          Object.entries(e.fieldErrors ?? {}).map(([campo, msgs]) => [campo, msgs[0]]),
        )
        setErrosCampo(porCampo)
        setErroGeral(
          e.detail ?? (Object.keys(porCampo).length ? null : 'Não foi possível abrir o chamado.'),
        )
      } else {
        setErroGeral('Não foi possível abrir o chamado.')
      }
    }
  }

  return (
    <div className="novo-ticket">
      {/* ---------- barra de identificação ---------- */}
      <div className="novo-ticket__bar">
        <span className="novo-ticket__ident">
          <IconTicket className="novo-ticket__ident-icon" />
          Abrir chamado
        </span>
        <div className="novo-ticket__bar-right">
          {/* Status é informativo, não editável: o backend cria SEMPRE como
              "Novo" (ticket_service grava status fixo) e não aceita escolha.
              Um seletor aqui seria um controle que não controla nada. */}
          <Tag tone="blue" dot>
            Novo
          </Tag>
        </div>
      </div>

      <div className="novo-ticket__body">
        {/* ---------- coluna de propriedades ---------- */}
        <aside className="novo-ticket__props">
          <Select
            label="Empresa"
            helper="Opcional — só encurta a lista de pessoas."
            value={empresaId == null ? '' : String(empresaId)}
            onChange={(e) => trocarEmpresa(e.target.value)}
            options={[
              { value: '', label: empresas ? 'Todas as empresas' : 'Carregando…' },
              ...(empresas ?? []).map((e) => ({ value: String(e.id), label: e.name })),
            ]}
          />

          <Combobox
            label="Solicitante"
            placeholder={carregandoClientes ? 'Carregando…' : 'Buscar solicitante'}
            emptyLabel="Nenhum cliente com esse nome."
            error={errosCampo.requester_id}
            options={opcoesSolicitante}
            value={solicitanteId}
            onChange={(v) => {
              setSolicitanteId(v)
              limparErro('requester_id')
              // Aplicar a macro antes de escolher o solicitante é a ordem
              // natural para quem já sabe o que vai escrever. Quando a pessoa
              // aparece, os marcadores que sobraram são preenchidos — só eles,
              // nunca o texto que o agente digitou.
              const c = (clientes ?? []).find((x) => String(x.id) === v)
              if (c) {
                setDescricao((atual) =>
                  marcadoresPendentes(atual).length
                    ? interpolar(atual, {
                        solicitante: c.full_name,
                        empresa: nomeEmpresa(c.company) || undefined,
                      })
                    : atual,
                )
              }
            }}
          />

          {temServicos && (
            <Select
              label="Serviço"
              helper="Opcional — filtra as categorias abaixo."
              value={servicoId}
              onChange={(e) => trocarServico(e.target.value)}
              options={[
                { value: '', label: 'Todos os serviços' },
                ...(servicos ?? []).map((s) => ({ value: String(s.id), label: s.name })),
              ]}
            />
          )}

          {/* Par lado a lado, como na referência — as duas são pequenas e
              andam juntas na cabeça de quem classifica o chamado. */}
          <div className="novo-ticket__par">
            <Select
              label="Categoria"
              helper="Opcional — a triagem pode classificar depois."
              error={errosCampo.category_id}
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              options={[
                { value: '', label: 'Sem categoria' },
                ...categoriasDoServico.map((c) => ({ value: String(c.id), label: c.name })),
              ]}
            />

            <Select
              label="Urgência"
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value as Prioridade)}
              options={PRIORIDADES.map((p) => ({ value: p.value, label: p.label }))}
            />
          </div>

          <Select
            label="Equipe"
            error={errosCampo.team_id}
            helper={
              me && !me.is_admin && equipesDisponiveis.length === 0
                ? 'Você não atende nenhuma equipe — a abertura fica com quem atende.'
                : estimativa?.label
                  ? `Primeira resposta costuma sair em ${estimativa.label}.`
                  : 'Quem vai atender o chamado.'
            }
            value={equipeId}
            onChange={(e) => {
              setEquipeId(e.target.value)
              limparErro('team_id')
            }}
            options={[
              { value: '', label: equipes ? '- Selecione -' : 'Carregando…' },
              ...equipesDisponiveis.map((e) => ({ value: String(e.id), label: e.name })),
            ]}
          />

          <div>
            <Combobox
              label="Responsável"
              placeholder="Sem responsável"
              emptyLabel="Nenhum agente com esse nome."
              helper="Opcional — pode ficar para a triagem."
              options={opcoesAgente}
              value={responsavelId}
              onChange={setResponsavelId}
            />
            {me && (
              <button
                type="button"
                className="novo-ticket__link"
                onClick={() => setResponsavelId(String(me.id))}
              >
                Atribuir para mim
              </button>
            )}
          </div>

          {/* Mesma regra do Serviço: sem nenhuma tag cadastrada o campo não
              tem o que oferecer, e some em vez de virar um controle morto. */}
          {opcoesTags.length > 0 && (
            <Combobox
              multiple
              label="Tags"
              placeholder="Buscar tag"
              emptyLabel="Nenhuma tag com esse nome."
              options={opcoesTags}
              value={tagIds}
              onChange={setTagIds}
            />
          )}

          <TextInput
            label="Nº do pedido"
            helper="Opcional, sem formato fixo — cada loja numera do seu jeito."
            maxLength={40}
            error={errosCampo.order_number}
            value={numeroPedido}
            onChange={(e) => setNumeroPedido(e.target.value)}
          />
        </aside>

        {/* ---------- coluna de redação ---------- */}
        <section className="novo-ticket__compose">
          {erroGeral && (
            <Notification tone="danger" title="Não deu para abrir" onDismiss={() => setErroGeral(null)}>
              {erroGeral}
            </Notification>
          )}

          {pendencia && (
            <Notification tone="warning" title={`${pendencia.referencia} foi aberto, mas com pendência`}>
              {pendencia.itens.join(' e ')} — dá para ajustar no próprio chamado.{' '}
              <button
                type="button"
                className="novo-ticket__link novo-ticket__link--inline"
                onClick={() => navigate(`/chamados/${pendencia.id}`)}
              >
                Abrir {pendencia.referencia}
              </button>
            </Notification>
          )}

          <div className="novo-ticket__assunto">
            <TextInput
              label="Assunto"
              placeholder="Resuma o chamado em uma linha"
              maxLength={200}
              error={errosCampo.subject}
              value={assunto}
              onChange={(e) => {
                setAssunto(e.target.value)
                limparErro('subject')
              }}
            />
          </div>

          {/*
            Card do composer — mesma moldura do ReplyEditor do cvzdesk (borda
            com friso azul no topo), mas SEM o seletor de modo dele: na
            abertura o primeiro registro é SEMPRE público
            (TicketCreateSerializer não tem `is_public` nem aceita nota
            interna na criação — isso só existe depois, na resposta). A aba
            "Ação interna" fica visível e com tooltip explicando por quê, em
            vez de simplesmente sumir — a pessoa vendo a referência original
            não deveria achar que esquecemos o botão.
          */}
          <div className="novo-ticket__composer">
            <div className="novo-ticket__composer-modo" role="tablist">
              <span className="novo-ticket__composer-tab novo-ticket__composer-tab--ativa" role="tab" aria-selected="true">
                Ação pública
              </span>
              <Tooltip label="Não disponível ao abrir — o primeiro registro de um chamado novo é sempre público. Dá para adicionar uma nota interna depois de criado." side="bottom">
                <button
                  type="button"
                  className="novo-ticket__composer-tab novo-ticket__composer-tab--inerte"
                  role="tab"
                  aria-selected="false"
                  aria-disabled="true"
                  onClick={(e) => e.preventDefault()}
                >
                  Ação interna
                </button>
              </Tooltip>
            </div>

            <div className="novo-ticket__composer-toolbar">
              <button type="button" aria-label="Negrito" onClick={() => envolverSelecao('**')}>
                <IconBold />
              </button>
              <button type="button" aria-label="Itálico" onClick={() => envolverSelecao('_')}>
                <IconItalic />
              </button>
              <button type="button" aria-label="Lista" onClick={() => inserirPrefixoDeLinha('- ')}>
                <IconList />
              </button>
              <button type="button" aria-label="Link" onClick={() => envolverSelecao('[', '](url)')}>
                <IconLink />
              </button>

              <span className="novo-ticket__composer-sep" />

              <button
                type="button"
                aria-label="Anexar arquivo"
                aria-expanded={mostrarAnexos}
                className={mostrarAnexos ? 'is-ativo' : undefined}
                onClick={() => setMostrarAnexos((v) => !v)}
              >
                <IconPaperclip />
              </button>

              {macros && macros.length > 0 && (
                <Popover
                  trigger={(p) => (
                    <button type="button" aria-label="Aplicar macro" {...p}>
                      <IconZap />
                    </button>
                  )}
                >
                  {(fechar) => (
                    <div className="novo-ticket__macros">
                      <span className="novo-ticket__macros-cap">Respostas prontas</span>
                      {macros.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            aplicarMacro(m)
                            fechar()
                          }}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  )}
                </Popover>
              )}
            </div>

            {mostrarAnexos && (
              <div className="novo-ticket__composer-anexos">
                <FileUpload files={arquivos} onChange={setArquivos} maxSizeMb={MAX_MB} />
              </div>
            )}

            <Field error={errosCampo.body}>
              <textarea
                ref={textareaRef}
                className="control control--area novo-ticket__composer-textarea"
                placeholder="Escreva a mensagem para o cliente…"
                aria-invalid={errosCampo.body ? true : undefined}
                value={descricao}
                onChange={(e) => {
                  setDescricao(e.target.value)
                  limparErro('body')
                }}
                onKeyDown={aoTeclarNoEditor}
              />
            </Field>

            {assinaturaLigada && assinatura && (
              <pre className="novo-ticket__assinatura-previa">{assinatura}</pre>
            )}

            <div className="novo-ticket__composer-foot">
              <span className="novo-ticket__composer-contagem">Palavras: {contagemPalavras}</span>
              {assinatura && (
                <Checkbox
                  label="Incluir minha assinatura"
                  checked={assinaturaLigada}
                  onChange={(e) => setAssinaturaLigada(e.target.checked)}
                />
              )}
            </div>
          </div>

          <p className="novo-ticket__helper-descricao">
            Vira a primeira mensagem do chamado, sempre visível para o cliente.
          </p>
        </section>
      </div>

      {/* ---------- rodapé fixo ---------- */}
      <div className="novo-ticket__foot">
        <span className="novo-ticket__foot-aviso">
          Aberto em nome do cliente — não consome a cota da empresa.
        </span>
        <Button variant="ghost" onClick={() => navigate('/chamados')} disabled={abrir.isPending}>
          Cancelar
        </Button>
        <Button onClick={enviar} disabled={abrir.isPending}>
          {abrir.isPending ? 'Abrindo…' : 'Abrir chamado'}
        </Button>
      </div>
    </div>
  )
}
