import { useMemo, useState } from 'react'
import { Button, DataTable, ErrorState, Select, TextInput, Toggle, type Column } from '@/cvz/components'
import { IconPlus } from '@/cvz/components/icons'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import {
  useAtualizarCategoriaCfg,
  useCriarCategoriaCfg,
  useCategoriasCfg,
  useServicosCfg,
  type CategoriaCfg,
} from './dados'

export function AbaCategorias() {
  const { data: itens, isLoading, isError, error, refetch } = useCategoriasCfg()
  const { data: servicos } = useServicosCfg()
  const criar = useCriarCategoriaCfg()
  const { push } = useToast()

  const [nomeNovo, setNomeNovo] = useState('')
  const [servicoNovo, setServicoNovo] = useState('')

  const opcoesServico = useMemo(
    () => [{ value: '', label: 'Sem serviço' }, ...(servicos ?? []).map((s) => ({ value: String(s.id), label: s.name }))],
    [servicos],
  )

  async function adicionar() {
    if (!nomeNovo.trim()) return
    try {
      await criar.mutateAsync({
        name: nomeNovo.trim(),
        service: servicoNovo ? Number(servicoNovo) : null,
      })
      setNomeNovo('')
      setServicoNovo('')
      push({ tone: 'success', title: 'Categoria criada' })
    } catch (e) {
      push({ tone: 'danger', title: 'Não foi possível criar', description: e instanceof ApiError ? e.detail : undefined })
    }
  }

  const colunas: Column<CategoriaCfg>[] = [
    { key: 'name', header: 'Nome', mobile: 'title', render: (c) => <CampoNome item={c} /> },
    {
      key: 'service_name',
      header: 'Serviço',
      mobile: 'meta',
      render: (c) => <CampoServico item={c} opcoes={opcoesServico} />,
    },
    {
      key: 'ticket_count',
      header: 'Tickets',
      numeric: true,
      mobile: 'meta',
      sortBy: (c) => c.ticket_count,
      render: (c) => c.ticket_count,
    },
    { key: 'is_active', header: 'Ativa', mobile: 'meta', render: (c) => <CampoAtivo item={c} /> },
  ]

  if (isError) {
    return <ErrorState description={error instanceof ApiError ? error.detail : undefined} onRetry={() => refetch()} />
  }

  return (
    <div className="cfg-aba">
      <div className="cfg-aba__add-linha">
        <TextInput
          placeholder="Nome da categoria"
          value={nomeNovo}
          onChange={(e) => setNomeNovo(e.target.value)}
        />
        <Select value={servicoNovo} onChange={(e) => setServicoNovo(e.target.value)} options={opcoesServico} />
        <Button Icon={IconPlus} onClick={adicionar} disabled={criar.isPending || !nomeNovo.trim()}>
          Adicionar
        </Button>
      </div>

      <DataTable
        rows={itens ?? []}
        columns={colunas}
        rowKey={(c) => String(c.id)}
        loading={isLoading}
        empty="Nenhuma categoria cadastrada."
      />
    </div>
  )
}

function CampoNome({ item }: { item: CategoriaCfg }) {
  const atualizar = useAtualizarCategoriaCfg(item.id)
  const { push } = useToast()
  const [valor, setValor] = useState(item.name)
  return (
    <input
      className="cfg-inline-input"
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onBlur={() => {
        if (!valor.trim() || valor === item.name) return
        atualizar.mutate(
          { name: valor.trim() },
          {
            onError: (e) => {
              setValor(item.name)
              push({
                tone: 'danger',
                title: 'Não foi possível renomear',
                description: e instanceof ApiError ? e.detail : undefined,
              })
            },
          },
        )
      }}
    />
  )
}

function CampoServico({ item, opcoes }: { item: CategoriaCfg; opcoes: { value: string; label: string }[] }) {
  const atualizar = useAtualizarCategoriaCfg(item.id)
  const { push } = useToast()
  return (
    <select
      className="cfg-inline-select"
      value={item.service == null ? '' : String(item.service)}
      onChange={(e) =>
        atualizar.mutate(
          { service: e.target.value ? Number(e.target.value) : null },
          {
            onError: (err) =>
              push({
                tone: 'danger',
                title: 'Não foi possível vincular o serviço',
                description: err instanceof ApiError ? err.detail : undefined,
              }),
          },
        )
      }
    >
      {opcoes.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function CampoAtivo({ item }: { item: CategoriaCfg }) {
  const atualizar = useAtualizarCategoriaCfg(item.id)
  const { push } = useToast()
  return (
    <Toggle
      checked={item.is_active}
      onChange={(e) =>
        atualizar.mutate(
          { is_active: e.target.checked },
          {
            onError: (err) =>
              push({
                tone: 'danger',
                title: 'Não foi possível alterar',
                description: err instanceof ApiError ? err.detail : undefined,
              }),
          },
        )
      }
      aria-label={`Categoria ${item.name} ${item.is_active ? 'ativa' : 'inativa'}`}
    />
  )
}
