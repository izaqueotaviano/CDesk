import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Button,
  DataTable,
  ErrorState,
  FormActions,
  IconPlus,
  IconUserPlus,
  PageHeader,
  Skeleton,
  Tabs,
  Tag,
  useToast,
  type Column,
} from '@/cvz/components'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { AbaDadosEmpresa } from './AbaDadosEmpresa'
import { AbaVisaoGeral } from './AbaVisaoGeral'
import { ModalConvidarUsuario } from './ModalConvidarUsuario'
import { ModalUsuario } from './ModalUsuario'
import { PainelChatEmbed } from './PainelChatEmbed'
import {
  formularioDe,
  useAtualizarEmpresa,
  useEmpresa,
  usePlanos,
  useUsuariosDaEmpresa,
  type Empresa,
  type FormularioEmpresa,
  type UsuarioCliente,
} from './dados'
import { clienteDesde } from './uso'
import './clientes.scss'
import './detalhe-empresa.scss'

/** As abas, na ordem da tela. A escolhida mora na URL (`?aba=`): recarregar
 *  ou colar o link volta para a mesma aba, como no resto do console. */
const ABAS = ['geral', 'dados', 'usuarios', 'chat-embed'] as const
type Aba = (typeof ABAS)[number]

function abaDaUrl(valor: string | null): Aba {
  return (ABAS as readonly string[]).includes(valor ?? '') ? (valor as Aba) : 'geral'
}

/**
 * Página da empresa no console — o "Cliente 360".
 *
 * Abre no que está acontecendo com o cliente (tickets abertos, conversas,
 * consumo, contatos — aba "Visão geral"), não no formulário de cadastro,
 * que foi para a aba "Dados" com o mesmo comportamento de antes. O
 * cabeçalho carrega os fatos da conta e as duas ações que se fazem daqui:
 * abrir um ticket para esta empresa e editar o cadastro.
 */
export function PaginaDetalheEmpresa() {
  const params = useParams<{ id: string }>()
  const id = Number(params.id)
  const idValido = Number.isInteger(id) && id > 0
  const navigate = useNavigate()
  const { push } = useToast()
  const [busca, setBusca] = useSearchParams()

  const { data: me } = useMe()
  // `IsInternalReadAdminWrite`: interno lê a empresa, só admin escreve. Sem
  // isto o agente preenchia o formulário inteiro para levar 403 no "Salvar".
  const podeEditar = (me?.permissions ?? []).includes('settings.manage')
  const { data: empresa, isLoading, isError, error, refetch } = useEmpresa(id)
  const { data: planos } = usePlanos()
  const atualizar = useAtualizarEmpresa(id)
  // Os contatos aparecem já na visão geral — a lista é a mesma da aba
  // "Usuários" (mesma chave de cache), então pedir cedo não duplica nada.
  const usuariosQuery = useUsuariosDaEmpresa(id, idValido)

  const [form, setForm] = useState<FormularioEmpresa | null>(null)
  const [aba, setAba] = useState<Aba>(() => abaDaUrl(busca.get('aba')))
  // `Tabs` do catálogo é não controlado (só `defaultId`). Trocar de aba POR
  // FORA dele (o "Editar dados" do cabeçalho, o "Ver todos" dos contatos)
  // remonta o componente com a aba nova — esta versão é a chave. O clique
  // numa aba não mexe nela, então o uso normal nunca remonta nada.
  const [versaoAbas, setVersaoAbas] = useState(0)
  const abasRef = useRef<HTMLDivElement>(null)
  const [modalConvidarAberto, setModalConvidarAberto] = useState(false)
  // Quem está aberto na ficha, e em que modo. Um estado só (e não um par
  // "usuário" + "modo" solto) porque os dois só fazem sentido juntos.
  const [fichaUsuario, setFichaUsuario] = useState<
    { usuario: UsuarioCliente; modo: 'ver' | 'editar' } | null
  >(null)
  const [erro, setErro] = useState<string | null>(null)

  // Só inicializa o form quando a empresa chega — depois disso, edições locais
  // não são sobrescritas por um refetch em segundo plano. Ajuste de estado
  // durante a renderização (não em efeito): assim que `empresa` aparece pela
  // primeira vez, semeia o form nesse mesmo ciclo de render.
  if (empresa && !form) setForm(formularioDe(empresa))

  // Depois de uma troca de aba por fora, o foco vai para a aba nova — quem
  // usa teclado continua de onde a tela foi, não do botão que ficou para trás.
  useEffect(() => {
    if (versaoAbas === 0) return
    abasRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
  }, [versaoAbas])

  function trocarAba(proxima: string) {
    const alvo = abaDaUrl(proxima)
    setAba(alvo)
    setBusca(
      (atual) => {
        const novo = new URLSearchParams(atual)
        if (alvo === 'geral') novo.delete('aba')
        else novo.set('aba', alvo)
        return novo
      },
      // refinamento da mesma tela, não uma parada nova no histórico
      { replace: true },
    )
  }

  function irParaAba(alvo: Aba) {
    trocarAba(alvo)
    setVersaoAbas((v) => v + 1)
  }

  function atualizarCampo<K extends keyof FormularioEmpresa>(campo: K, valor: FormularioEmpresa[K]) {
    setForm((f) => (f ? { ...f, [campo]: valor } : f))
  }

  async function salvar() {
    if (!form) return
    setErro(null)
    try {
      await atualizar.mutateAsync({
        ...form,
        tax_id: form.tax_id || null,
        limit_period: form.limit_period || null,
      })
      push({ tone: 'success', title: 'Empresa atualizada' })
    } catch (e) {
      setErro(e instanceof ApiError ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0]) : 'Não foi possível salvar.')
    }
  }

  // Abrir chamado já com a empresa escolhida. `?empresa=` é o recorte da
  // tela de novo ticket (o filtro acima do campo "Para").
  const novoTicket = () => navigate(`/tickets/novo?empresa=${id}`)
  const migalhas = [{ label: 'Clientes', onClick: () => navigate('/clientes') }]

  const colunasUsuarios: Column<UsuarioCliente>[] = [
    {
      key: 'full_name',
      header: 'Nome',
      mobile: 'title',
      sortBy: (u) => u.full_name,
      render: (u) => (
        <div>
          <div>{u.full_name}</div>
          <span className="clientes-meta">{u.email}</span>
        </div>
      ),
    },
    {
      key: 'client_role',
      header: 'Papel',
      mobile: 'meta',
      render: (u) => <Tag tone="blue">{u.client_role === 'owner' ? 'Responsável' : 'Usuário'}</Tag>,
    },
    {
      key: 'phone',
      header: 'Telefone',
      mobile: 'meta',
      // O primeiro, ou o secundário quando só ele existe — o cadastro exige um
      // dos dois, então mostrar só `phone` deixava linha com traço em quem tem
      // telefone cadastrado.
      render: (u) => u.phone || u.phone_secondary || '—',
    },
    {
      key: 'invite_status',
      header: 'Convite',
      mobile: 'meta',
      // O backend responde em português ('aceito'/'pendente'/'visitante', ver
      // `UserAdminSerializer.get_invite_status`); comparar com 'accepted'
      // fazia todo mundo aparecer como pendente, inclusive quem já entrou.
      //
      // 'visitante' é quem se identificou no chat público do site (não houve
      // convite nenhum) — em tom neutro de propósito: não é uma pendência
      // pra alguém resolver, é como aquela pessoa entrou.
      render: (u) =>
        u.invite_status === 'visitante' ? (
          <Tag>Visitante do chat</Tag>
        ) : (
          <Tag tone={u.invite_status === 'aceito' ? 'success' : 'away'}>
            {u.invite_status === 'aceito' ? 'Aceito' : 'Pendente'}
          </Tag>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      mobile: 'meta',
      render: (u) => (
        <Tag tone={u.is_active ? 'success' : 'neutral'} dot>
          {u.is_active ? 'Ativo' : 'Inativo'}
        </Tag>
      ),
    },
    {
      key: 'acoes',
      header: '',
      mobile: 'meta',
      render: (u) => (
        <div className="clientes-acoes">
          <Button variant="ghost" size="sm" onClick={() => setFichaUsuario({ usuario: u, modo: 'ver' })}>
            Ver
          </Button>
          {podeEditar && (
            <Button variant="ghost" size="sm" onClick={() => setFichaUsuario({ usuario: u, modo: 'editar' })}>
              Editar
            </Button>
          )}
        </div>
      ),
    },
  ]

  // Erro antes do "carregando": sem empresa o form nunca é semeado, e a
  // ordem inversa deixava um 404 preso no esqueleto para sempre.
  if (!idValido || isError) {
    const naoExiste = !idValido || (error instanceof ApiError && error.status === 404)
    return (
      <>
        <PageHeader title={naoExiste ? 'Empresa não encontrada' : 'Clientes'} breadcrumbs={migalhas} />
        <ErrorState
          title={naoExiste ? 'Esta empresa não existe ou saiu do cadastro' : undefined}
          description={naoExiste ? undefined : error instanceof ApiError ? error.detail : undefined}
          onRetry={naoExiste ? undefined : () => refetch()}
          action={
            naoExiste ? (
              <Button variant="secondary" size="sm" onClick={() => navigate('/clientes')}>
                Voltar para clientes
              </Button>
            ) : undefined
          }
        />
      </>
    )
  }

  if (isLoading || !empresa || !form) {
    return <EsqueletoDaPagina />
  }

  return (
    <>
      <CabecalhoEmpresa
        empresa={empresa}
        migalhas={[...migalhas, { label: empresa.name }]}
        acoes={
          <>
            {podeEditar && (
              <Button variant="secondary" onClick={() => irParaAba('dados')}>
                Editar dados
              </Button>
            )}
            <Button Icon={IconPlus} onClick={novoTicket}>
              Novo ticket
            </Button>
          </>
        }
      />

      <div ref={abasRef}>
        <Tabs
          key={versaoAbas}
          defaultId={aba}
          onChange={trocarAba}
          items={[
            {
              id: 'geral',
              label: 'Visão geral',
              content: (
                <AbaVisaoGeral
                  empresa={empresa}
                  usuarios={usuariosQuery.data}
                  carregandoUsuarios={usuariosQuery.isLoading}
                  erroUsuarios={usuariosQuery.error}
                  onRecarregarUsuarios={() => usuariosQuery.refetch()}
                  podeEditar={podeEditar}
                  onNovoTicket={novoTicket}
                  onVerUsuarios={() => irParaAba('usuarios')}
                  onConvidar={() => setModalConvidarAberto(true)}
                  onAbrirContato={(u) => setFichaUsuario({ usuario: u, modo: 'ver' })}
                  onConfigurarChat={() => irParaAba('chat-embed')}
                />
              ),
            },
            {
              id: 'dados',
              label: 'Dados',
              content: (
                <AbaDadosEmpresa
                  empresa={empresa}
                  planos={planos}
                  form={form}
                  onCampo={atualizarCampo}
                  podeEditar={podeEditar}
                  erro={erro}
                  salvando={atualizar.isPending}
                  onSalvar={salvar}
                />
              ),
            },
            {
              id: 'usuarios',
              label: 'Usuários',
              count: empresa.user_count,
              content: (
                <>
                  {podeEditar && (
                    <FormActions>
                      <Button Icon={IconUserPlus} variant="tertiary" onClick={() => setModalConvidarAberto(true)}>
                        Convidar usuário
                      </Button>
                    </FormActions>
                  )}
                  <DataTable
                    rows={usuariosQuery.data ?? []}
                    columns={colunasUsuarios}
                    rowKey={(u) => String(u.id)}
                    loading={usuariosQuery.isLoading}
                    empty="Nenhum usuário cadastrado nessa empresa ainda."
                  />
                </>
              ),
            },
            {
              id: 'chat-embed',
              label: 'Chat embutido',
              content: <PainelChatEmbed empresaId={id} habilitado={aba === 'chat-embed'} />,
            },
          ]}
        />
      </div>

      <ModalConvidarUsuario
        empresaId={id}
        open={modalConvidarAberto}
        onClose={() => setModalConvidarAberto(false)}
      />

      {/* Montado só com alguém selecionado: assim a ficha nasce já semeada
          com o usuário certo, sem estado de formulário a ressincronizar. */}
      {fichaUsuario && (
        <ModalUsuario
          empresaId={id}
          usuario={fichaUsuario.usuario}
          modoInicial={fichaUsuario.modo}
          podeEditar={podeEditar}
          onClose={() => setFichaUsuario(null)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Cabeçalho: nome, estado, plano e os fatos da conta
// ---------------------------------------------------------------------------

type Migalha = { label: string; onClick?: () => void }

function CabecalhoEmpresa({
  empresa,
  migalhas,
  acoes,
}: {
  empresa: Empresa
  migalhas: Migalha[]
  acoes: ReactNode
}) {
  const desde = clienteDesde(empresa.contract_started_at, empresa.created_at)
  const dominios = empresa.domains
  // Razão social e documento na linha de apoio — é o que se confere ao
  // falar de contrato/cobrança, e nenhum dos dois cabe como "fato".
  const apoio = [empresa.legal_name, empresa.tax_id].filter(Boolean).join(' · ')

  return (
    <>
      <PageHeader
        title={empresa.name}
        titleAdornment={
          <>
            <Tag tone={empresa.is_active ? 'success' : 'neutral'} dot>
              {empresa.is_active ? 'Ativa' : 'Inativa'}
            </Tag>
            {/* Plano é rótulo, não estado: pílula neutra. */}
            <Tag>Plano {empresa.plan_name}</Tag>
          </>
        }
        description={apoio || undefined}
        breadcrumbs={migalhas}
        actions={acoes}
      />
      <dl className="empresa-fatos">
        <div className="empresa-fatos__item">
          <dt>Usuários</dt>
          <dd>{empresa.user_count}</dd>
        </div>
        {desde && (
          <div className="empresa-fatos__item">
            <dt>Cliente desde</dt>
            <dd>{desde}</dd>
          </div>
        )}
        {empresa.account_manager_name && (
          <div className="empresa-fatos__item">
            <dt>Gerente de conta</dt>
            <dd>{empresa.account_manager_name}</dd>
          </div>
        )}
        {dominios.length > 0 && (
          <div className="empresa-fatos__item">
            <dt>{dominios.length === 1 ? 'Domínio' : 'Domínios'}</dt>
            <dd title={dominios.join(', ')}>
              {dominios[0]}
              {dominios.length > 1 && ` e mais ${dominios.length - 1}`}
            </dd>
          </div>
        )}
      </dl>
    </>
  )
}

/** Carregando: o esqueleto tem a forma da página — título, fatos, abas e os
 *  blocos da visão geral — para nada "pular" quando os dados chegam. */
function EsqueletoDaPagina() {
  const bloco = (linhas: number, i: number) => (
    <div key={i} className="empresa-bloco">
      <Skeleton width="35%" height="14px" />
      <ul className="empresa-lista">
        {Array.from({ length: linhas }, (_, j) => (
          <li key={j} className="empresa-lista__esqueleto">
            <Skeleton lines={2} />
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <div className="empresa-esqueleto" aria-busy="true">
      <p className="sr-only" role="status">
        Carregando empresa…
      </p>
      <div className="empresa-esqueleto__titulo" aria-hidden="true">
        <Skeleton width="20%" />
        <Skeleton height="28px" width="55%" />
        <Skeleton width="35%" />
      </div>
      <div className="empresa-esqueleto__fatos" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} lines={2} />
        ))}
      </div>
      <div aria-hidden="true">
        <Skeleton height="36px" width="min(420px, 100%)" />
      </div>
      <div className="empresa-visao" aria-hidden="true">
        <div className="empresa-visao__coluna">{[3, 3].map(bloco)}</div>
        <div className="empresa-visao__coluna">{[2, 3].map(bloco)}</div>
      </div>
    </div>
  )
}
