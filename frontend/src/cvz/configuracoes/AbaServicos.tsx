import { useState } from 'react'
import { Button, DataTable, ErrorState, TextInput, Toggle, type Column } from '@/cvz/components'
import { IconPlus } from '@/cvz/components/icons'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import { useAtualizarServico, useCriarServico, useServicosCfg, type Servico } from './dados'

/** Serviço é o nível acima de Categoria (Integrações, Loja, Pedidos...).
 *  Categoria escolhe um serviço opcionalmente, pra filtrar na abertura do
 *  chamado — ver PaginaNovoTicket. */
export function AbaServicos() {
  const { data: itens, isLoading, isError, error, refetch } = useServicosCfg()
  const criar = useCriarServico()
  const { push } = useToast()
  const [nomeNovo, setNomeNovo] = useState('')

  async function adicionar() {
    if (!nomeNovo.trim()) return
    try {
      await criar.mutateAsync({ name: nomeNovo.trim() })
      setNomeNovo('')
      push({ tone: 'success', title: 'Serviço criado' })
    } catch (e) {
      push({ tone: 'danger', title: 'Não foi possível criar', description: e instanceof ApiError ? e.detail : undefined })
    }
  }

  const colunas: Column<Servico>[] = [
    { key: 'name', header: 'Nome', mobile: 'title', render: (s) => <CampoNome item={s} /> },
    {
      key: 'category_count',
      header: 'Categorias',
      numeric: true,
      mobile: 'meta',
      sortBy: (s) => s.category_count,
      render: (s) => s.category_count,
    },
    {
      key: 'is_active',
      header: 'Ativo',
      mobile: 'meta',
      render: (s) => <CampoAtivo item={s} />,
    },
  ]

  if (isError) {
    return <ErrorState description={error instanceof ApiError ? error.detail : undefined} onRetry={() => refetch()} />
  }

  return (
    <div className="cfg-aba">
      <div className="cfg-aba__add-linha">
        <TextInput
          placeholder="Nome do serviço"
          value={nomeNovo}
          onChange={(e) => setNomeNovo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && adicionar()}
        />
        <Button Icon={IconPlus} onClick={adicionar} disabled={criar.isPending || !nomeNovo.trim()}>
          Adicionar
        </Button>
      </div>

      <DataTable
        rows={itens ?? []}
        columns={colunas}
        rowKey={(s) => String(s.id)}
        loading={isLoading}
        empty="Nenhum serviço cadastrado."
      />
    </div>
  )
}

function CampoNome({ item }: { item: Servico }) {
  const atualizar = useAtualizarServico(item.id)
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

function CampoAtivo({ item }: { item: Servico }) {
  const atualizar = useAtualizarServico(item.id)
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
      aria-label={`Serviço ${item.name} ${item.is_active ? 'ativo' : 'inativo'}`}
    />
  )
}
