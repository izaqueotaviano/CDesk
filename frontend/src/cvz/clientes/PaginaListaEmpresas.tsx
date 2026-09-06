import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  DataTable,
  ErrorState,
  FilterBar,
  IconPlus,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Tag,
  type Column,
} from '@/cvz/components'
import { ApiError } from '@/api/client'
import { ModalNovaEmpresa } from './ModalNovaEmpresa'
import { useEmpresas, type Empresa } from './dados'
import './clientes.scss'

const TAMANHO_PAGINA = 20

export function PaginaListaEmpresas() {
  const navigate = useNavigate()
  const [busca, setBusca] = useState('')
  const [buscaDebounced, setBuscaDebounced] = useState('')
  const [statusFiltro, setStatusFiltro] = useState<'' | 'true' | 'false'>('')
  const [pagina, setPagina] = useState(1)
  const [modalAberto, setModalAberto] = useState(false)

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
      render: (e) => <Tag tone="blue">{e.plan_name}</Tag>,
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
      render: (e) => (
        <span>
          {e.quota_usage.used}
          {e.quota_usage.limit != null ? ` / ${e.quota_usage.limit}` : ' (sem limite)'}
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
  ]

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Empresas atendidas — plano, cota do mês e usuários."
        actions={
          <Button Icon={IconPlus} onClick={() => setModalAberto(true)}>
            Nova empresa
          </Button>
        }
      />

      <FilterBar>
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

      <div style={{ marginTop: 16 }}>
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
            loading={isLoading}
            empty={
              <div className="clientes-vazio">
                {busca || statusFiltro
                  ? 'Nenhuma empresa bate com esse filtro.'
                  : 'Nenhuma empresa cadastrada ainda.'}
              </div>
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

      <ModalNovaEmpresa
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        onCriada={(id) => navigate(`/clientes/${id}`)}
      />
    </>
  )
}
