import { useState } from 'react'
import {
  Button,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Field,
  IconButton,
  Tag,
  TextInput,
  type Column,
} from '@/cvz/components'
import { IconPlus, IconTrash } from '@/cvz/components/icons'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import { useAtualizarTagCfg, useCriarTagCfg, useExcluirTagCfg, useTagsCfg, type TagCfg } from './dados'

export function AbaTags() {
  const { data: itens, isLoading, isError, error, refetch } = useTagsCfg()
  const criar = useCriarTagCfg()
  const excluir = useExcluirTagCfg()
  const { push } = useToast()

  const [nomeNovo, setNomeNovo] = useState('')
  const [corNova, setCorNova] = useState('#0275DE')
  const [paraExcluir, setParaExcluir] = useState<TagCfg | null>(null)

  async function adicionar() {
    if (!nomeNovo.trim()) return
    try {
      await criar.mutateAsync({ name: nomeNovo.trim(), color: corNova })
      setNomeNovo('')
      push({ tone: 'success', title: 'Tag criada' })
    } catch (e) {
      push({ tone: 'danger', title: 'Não foi possível criar', description: e instanceof ApiError ? e.detail : undefined })
    }
  }

  const colunas: Column<TagCfg>[] = [
    {
      key: 'preview',
      header: '',
      width: '90px',
      render: (t) => (
        <Tag tone="neutral" dot>
          {t.name}
        </Tag>
      ),
    },
    { key: 'name', header: 'Nome', mobile: 'title', render: (t) => <CampoNome item={t} /> },
    {
      key: 'color',
      header: 'Cor',
      mobile: 'meta',
      render: (t) => <CampoCor item={t} />,
    },
    {
      key: 'excluir',
      header: '',
      mobile: 'hidden',
      render: (t) => (
        <IconButton
          Icon={IconTrash}
          label={`Excluir ${t.name}`}
          size="sm"
          bare
          onClick={() => setParaExcluir(t)}
        />
      ),
    },
  ]

  if (isError) {
    return <ErrorState description={error instanceof ApiError ? error.detail : undefined} onRetry={() => refetch()} />
  }

  return (
    <div className="cfg-aba">
      <div className="cfg-aba__add-linha">
        <TextInput placeholder="Nome da tag" value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} />
        <Field label="Cor">
          <input type="color" className="cfg-cor-input" value={corNova} onChange={(e) => setCorNova(e.target.value)} />
        </Field>
        <Button Icon={IconPlus} size="sm" onClick={adicionar} disabled={criar.isPending || !nomeNovo.trim()}>
          Adicionar
        </Button>
      </div>

      <DataTable
        rows={itens ?? []}
        columns={colunas}
        rowKey={(t) => String(t.id)}
        loading={isLoading}
        empty="Nenhuma tag cadastrada."
      />

      <ConfirmDialog
        open={!!paraExcluir}
        onClose={() => setParaExcluir(null)}
        onConfirm={async () => {
          if (!paraExcluir) return
          try {
            await excluir.mutateAsync(paraExcluir.id)
            push({ tone: 'success', title: 'Tag excluída' })
          } catch (e) {
            push({
              tone: 'danger',
              title: 'Não foi possível excluir',
              description: e instanceof ApiError ? e.detail : 'A tag pode estar em uso.',
            })
          }
        }}
        title={`Excluir "${paraExcluir?.name}"?`}
        description="Some de qualquer ticket que a usa hoje. Não dá pra desfazer."
        confirmLabel="Excluir"
        danger
      />
    </div>
  )
}

function CampoNome({ item }: { item: TagCfg }) {
  const atualizar = useAtualizarTagCfg(item.id)
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

function CampoCor({ item }: { item: TagCfg }) {
  const atualizar = useAtualizarTagCfg(item.id)
  const { push } = useToast()
  return (
    <input
      type="color"
      className="cfg-cor-input"
      value={item.color}
      onChange={(e) =>
        atualizar.mutate(
          { color: e.target.value },
          {
            onError: (err) =>
              push({
                tone: 'danger',
                title: 'Não foi possível trocar a cor',
                description: err instanceof ApiError ? err.detail : undefined,
              }),
          },
        )
      }
    />
  )
}
