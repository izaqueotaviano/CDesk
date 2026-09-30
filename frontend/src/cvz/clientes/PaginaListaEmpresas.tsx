import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  DataTable,
  DensityToggle,
  EmptyState,
  ErrorState,
  FilterBar,
  IconClients,
  IconPlus,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Tag,
  type Column,
} from '@/cvz/components'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { ModalEmpresa } from './ModalEmpresa'
import { useEmpresas, type Empresa } from './dados'
import { toneDoPlano } from './planos'
import './clientes.scss'

const TAMANHO_PAGINA = 20

export function PaginaListaEmpresas() {
  const navigate = useNavigate()
  const { data: me } = useMe()
  // Escrita em `settings/*` é de admin (`IsInternalReadAdminWrite`) — o agente
  // lê a lista e não altera nada. Esconder é melhor que deixar clicar e
  // colher 403.
  const podeEditar = (me?.permissions ?? []).includes('settings.manage')
  const [busca, setBusca] = useState('')
  const [buscaDebounced, setBuscaDebounced] = useState('')
  const [statusFiltro, setStatusFiltro] = useState<'' | 'true' | 'false'>('')
  const [pagina, setPagina] = useState(1)
  const [modalAberto, setModalAberto] = useState(false)
  const [empresaEmEdicao, setEmpresaEmEdicao] = useState<Empresa | null>(null)

  // 300ms parado de digitar antes de bater no servidor — sem isso cada tecla
  // vira uma requisição (e a resposta de uma tecla anterior podia chegar
  // depois e "desfazer" a busca mais recente na tela).
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca.trim()), 300)
    return () => clearTimeout(t)
  }, [busca])

  const { data, isLoading, isError, error, refetch } = useEmpresas({
    q: buscaDebounced || undefined,
    is_active: statusFiltro === '' ? undefined : statusFiltro === 'true',
    limit: TAMANHO_PAGINA,
    offset: (pagina - 1) * TAMANHO_PAGINA,
  })

  const paginaAtual = data?.results ?? []
  const totalFiltrado = data?.count ?? 0

  const colunas: Column<Empresa>[] = [
    {
      key: 'name',
      header: 'Empresa',
      mobile: 'title',
      sortBy: (e) => e.name,
      render: (e) => (
        <div>
          <div>{e.name}</div>
          {e.domains.length > 0 && (
            <span className="clientes-meta">{e.domains.join(', ')}</span>
          )}
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plano',
      mobile: 'meta',
      sortBy: (e) => e.plan_name,
      // Um tom por plano (planos.ts) — antes era "blue" fixo e Black, Gold e
      // Platinum eram o mesmo selo.
      render: (e) => <Tag tone={toneDoPlano(e.plan_name)}>{e.plan_name}</Tag>,
    },
    {
      key: 'users',
      header: 'Usuários',
      numeric: true,
      mobile: 'meta',
      sortBy: (e) => e.user_count,
      render: (e) => e.user_count,
    },
    {
      key: 'quota',
      header: 'Cota do mês',
      numeric: true,
      mobile: 'meta',
      sortBy: (e) => e.quota_usage.used,
      // "sem limite" em cinza, depois do número: é contexto, não valor — e
      // entre parênteses na mesma cor ele disputava com o número.
      render: (e) => (
        <span>
          {e.quota_usage.used}
          {e.quota_usage.limit != null ? (
            ` / ${e.quota_usage.limit}`
          ) : (
            <span className="clientes-meta"> sem limite</span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      mobile: 'meta',
      sortBy: (e) => (e.is_active ? 0 : 1),
      render: (e) => (
        <Tag tone={e.is_active ? 'success' : 'neutral'} dot>
          {e.is_active ? 'Ativa' : 'Inativa'}
        </Tag>
      ),
    },
    // Abrir é a LINHA: ela inteira é clicável e o nome da empresa é um link
    // de verdade (Tab chega nele, Enter abre, Ctrl+clique abre em outra aba)
    // — o botão "Abrir" repetia isso em toda linha. Fica só o que a linha não
    // faz sozinha: editar sem sair da lista.
    ...(podeEditar
      ? [
          {
            key: 'acoes',
            header: '',
            mobile: 'meta' as const,
            width: '1%',
            render: (e: Empresa) => (
              <div className="clientes-acoes">
                <Button variant="ghost" size="sm" onClick={() => setEmpresaEmEdicao(e)}>
                  Editar
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ]

  const filtrando = busca !== '' || statusFiltro !== ''
  const limparFiltros = () => {
    setBusca('')
    setStatusFiltro('')
    setPagina(1)
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Empresas atendidas, com plano, cota do mês e usuários."
        actions={
          podeEditar && (
            <Button Icon={IconPlus} onClick={() => setModalAberto(true)}>
              Nova empresa
            </Button>
          )
        }
      />

      <FilterBar end={<DensityToggle />}>
        <SearchInput
          placeholder="Buscar por nome, razão social ou domínio…"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value)
            setPagina(1)
          }}
        />
        <Select
          aria-label="Status"
          value={statusFiltro}
          onChange={(e) => {
            setStatusFiltro(e.target.value as typeof statusFiltro)
            setPagina(1)
          }}
          options={[
            { value: '', label: 'Todos os status' },
            { value: 'true', label: 'Ativas' },
            { value: 'false', label: 'Inativas' },
          ]}
        />
      </FilterBar>

      <div className="clientes-lista">
        {isError ? (
          <ErrorState
            description={error instanceof ApiError ? error.detail : undefined}
            onRetry={() => refetch()}
          />
        ) : (
          <DataTable
            rows={paginaAtual}
            columns={colunas}
            rowKey={(e) => String(e.id)}
            onRowClick={(e) => navigate(`/clientes/${e.id}`)}
            rowHref={(e) => `/clientes/${e.id}`}
            loading={isLoading}
            loadingRows={8}
            empty={
              filtrando ? (
                <EmptyState
                  title="Nenhuma empresa com esse filtro"
                  description="Tente outro nome ou domínio, ou veja todas as empresas."
                  action={
                    <Button variant="secondary" size="sm" onClick={limparFiltros}>
                      Limpar filtros
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  Icon={IconClients}
                  title="Nenhuma empresa cadastrada"
                  description={
                    podeEditar
                      ? 'Cadastre a primeira empresa para abrir chamados em nome dela.'
                      : 'Quando um administrador cadastrar empresas, elas aparecem aqui.'
                  }
                  action={
                    podeEditar && (
                      <Button Icon={IconPlus} size="sm" onClick={() => setModalAberto(true)}>
                        Nova empresa
                      </Button>
                    )
                  }
                />
              )
            }
          />
        )}

        {!isLoading && !isError && totalFiltrado > TAMANHO_PAGINA && (
          <Pagination
            page={pagina}
            pageSize={TAMANHO_PAGINA}
            total={totalFiltrado}
            onPageChange={setPagina}
          />
        )}
      </div>

      <ModalEmpresa
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        onCriada={(id) => navigate(`/clientes/${id}`)}
      />

      <ModalEmpresa
        empresa={empresaEmEdicao}
        open={empresaEmEdicao !== null}
        onClose={() => setEmpresaEmEdicao(null)}
      />
    </>
  )
}
