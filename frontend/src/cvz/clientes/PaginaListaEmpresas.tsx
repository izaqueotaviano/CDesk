import { useMemo, useState } from 'react'
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
// A API de admin não expõe busca textual (só is_active + paginação) — busca
// aqui é sobre um lote real de até 100 registros, filtrado no cliente. Além
// disso o resultado passa a ser parcial; para uma base maior o backend
// precisaria ganhar `?q=` de verdade.
const LOTE_SERVIDOR = 100

export function PaginaListaEmpresas() {
  const navigate = useNavigate()
  const [busca, setBusca] = useState('')
  const [statusFiltro, setStatusFiltro] = useState<'' | 'true' | 'false'>('')
  const [pagina, setPagina] = useState(1)
  const [modalAberto, setModalAberto] = useState(false)

  const { data, isLoading, isError, error, refetch } = useEmpresas({
    is_active: statusFiltro === '' ? undefined : statusFiltro === 'true',
    limit: LOTE_SERVIDOR,
    offset: 0,
  })

  const todas = data?.results ?? []
  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return todas
    return todas.filter(
      (e) =>
        e.name.toLowerCase().includes(termo) ||
        e.legal_name.toLowerCase().includes(termo) ||
        e.slug.toLowerCase().includes(termo) ||
        e.domains.some((d) => d.includes(termo)),
    )
    // `data?.results` (não `todas`) é a dependência real — o `?? []` de fallback
    // cria um array novo a cada render e faria o memo recalcular sempre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.results, busca])

  const totalFiltrado = filtradas.length
  const pagina1 = (pagina - 1) * TAMANHO_PAGINA
  const paginaAtual = filtradas.slice(pagina1, pagina1 + TAMANHO_PAGINA)

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
