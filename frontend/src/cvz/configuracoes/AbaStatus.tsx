import { useState } from 'react'
import {
  Button,
  DataTable,
  ErrorState,
  Field,
  FormRow,
  Select,
  Tag,
  TextInput,
  Toggle,
  type Column,
} from '@/cvz/components'
import { IconPlus } from '@/cvz/components/icons'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import {
  useAtualizarStatus,
  useCriarStatus,
  useStatusList,
  type CategoriaStatus,
  type Status,
} from './dados'

const CATEGORIAS: { value: CategoriaStatus; label: string }[] = [
  { value: 'new', label: 'Novo' },
  { value: 'open', label: 'Aberto' },
  { value: 'pending_customer', label: 'Aguardando cliente' },
  { value: 'resolved', label: 'Resolvido' },
  { value: 'closed', label: 'Fechado' },
]

// Mesma paleta que o backend aplica quando o status novo não vem com cor
// explícita (`apps.tickets.models.COR_POR_CATEGORIA`, espelhando as cores
// dos quatro status de fábrica em migrations/0016_status_de_fabrica.py) —
// preview no formulário, não fonte de verdade: quem decide o valor final
// salvo é sempre o backend. `resolved` fica de fora de propósito: não é uma
// categoria real do backend (`TicketStatus`), então cai no fallback cinza
// como qualquer categoria que o backend não reconheça.
const PALETA_POR_CATEGORIA: Partial<Record<CategoriaStatus, string>> = {
  new: '#6C4E9C',
  open: '#5A87B8',
  pending_customer: '#E9A23B',
  closed: '#8A8A85',
}
const COR_PADRAO = '#8A8A85'
const corDaCategoria = (categoria: CategoriaStatus) => PALETA_POR_CATEGORIA[categoria] ?? COR_PADRAO

/**
 * Status = colunas do Kanban. O próprio backend documenta isso
 * (`TicketStageViewSet`: "criar um status aqui é criar uma coluna no
 * kanban, e vice-versa: é a mesma coisa vista de duas telas") — por isso
 * essa aba não tem irmã em nenhuma tela de quadro, e vice-versa.
 */
export function AbaStatus() {
  const { data: itens, isLoading, isError, error, refetch } = useStatusList()
  const criar = useCriarStatus()
  const { push } = useToast()

  const [nomeNovo, setNomeNovo] = useState('')
  const [categoriaNova, setCategoriaNova] = useState<CategoriaStatus>('open')
  const [corNova, setCorNova] = useState(corDaCategoria('open'))

  /** Troca a categoria e acompanha com a cor semântica dela — mas só
   *  enquanto a pessoa não tiver escolhido uma cor própria: se o campo de
   *  cor ainda mostra exatamente o valor sugerido para a categoria ANTERIOR,
   *  ninguém mexeu nele, e é seguro atualizar. Uma escolha manual sobrevive
   *  a idas e vindas no seletor de categoria. */
  function trocarCategoria(categoria: CategoriaStatus) {
    setCorNova((corAtual) => (corAtual === corDaCategoria(categoriaNova) ? corDaCategoria(categoria) : corAtual))
    setCategoriaNova(categoria)
  }

  async function adicionar() {
    if (!nomeNovo.trim()) return
    try {
      await criar.mutateAsync({ name: nomeNovo.trim(), category: categoriaNova, color: corNova })
      setNomeNovo('')
      push({ tone: 'success', title: 'Status criado' })
    } catch (e) {
      push({
        tone: 'danger',
        title: 'Não foi possível criar',
        description: e instanceof ApiError ? e.detail : undefined,
      })
    }
  }

  const colunas: Column<Status>[] = [
    { key: 'color', header: '', width: '32px', render: (s) => <ChipCor cor={s.color} /> },
    {
      key: 'name',
      header: 'Nome',
      mobile: 'title',
      render: (s) => <CampoNomeStatus item={s} />,
    },
    {
      key: 'category_label',
      header: 'Categoria',
      mobile: 'meta',
      render: (s) => <Tag tone="neutral">{s.category_label}</Tag>,
    },
    {
      key: 'ticket_count',
      header: 'Tickets',
      numeric: true,
      mobile: 'meta',
      sortBy: (s) => s.ticket_count,
      render: (s) => s.ticket_count,
    },
    {
      key: 'is_active',
      header: 'Ativo',
      mobile: 'meta',
      render: (s) => <CampoAtivoStatus item={s} />,
    },
    {
      key: 'is_system',
      header: '',
      mobile: 'hidden',
      render: (s) => (s.is_system ? <Tag tone="neutral">Do sistema</Tag> : null),
    },
  ]

  if (isError) {
    return (
      <ErrorState description={error instanceof ApiError ? error.detail : undefined} onRetry={() => refetch()} />
    )
  }

  return (
    <div className="cfg-aba">
      <FormRow columns="2-1">
        <TextInput
          label="Novo status"
          placeholder="Nome do status"
          value={nomeNovo}
          onChange={(e) => setNomeNovo(e.target.value)}
        />
        <Select
          label="Categoria"
          value={categoriaNova}
          onChange={(e) => trocarCategoria(e.target.value as CategoriaStatus)}
          options={CATEGORIAS}
        />
        <Field label="Cor">
          <input
            type="color"
            className="cfg-cor-input"
            value={corNova}
            onChange={(e) => setCorNova(e.target.value)}
          />
        </Field>
      </FormRow>
      <div className="cfg-aba__acao-add">
        <Button Icon={IconPlus} size="sm" onClick={adicionar} disabled={criar.isPending || !nomeNovo.trim()}>
          Adicionar status
        </Button>
      </div>

      <DataTable
        rows={itens ?? []}
        columns={colunas}
        rowKey={(s) => String(s.id)}
        loading={isLoading}
        empty="Nenhum status cadastrado."
      />
    </div>
  )
}

function ChipCor({ cor }: { cor: string }) {
  return <span className="cfg-chip-cor" style={{ backgroundColor: cor }} aria-hidden />
}

/** Nome editável direto na célula — salva ao sair do campo, só se mudou. */
function CampoNomeStatus({ item }: { item: Status }) {
  const atualizar = useAtualizarStatus(item.id)
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
            // Falha silenciosa aqui seria pior que qualquer toast: o campo
            // ficaria mostrando um nome que nunca foi salvo, sem a pessoa
            // saber. Volta pro valor real do servidor e avisa.
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

function CampoAtivoStatus({ item }: { item: Status }) {
  const atualizar = useAtualizarStatus(item.id)
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
      aria-label={`Status ${item.name} ${item.is_active ? 'ativo' : 'inativo'}`}
    />
  )
}
