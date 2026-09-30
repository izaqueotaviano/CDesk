import { useState } from 'react'
import {
  Button,
  Checkbox,
  DataTable,
  ErrorState,
  Field,
  FormRow,
  IconButton,
  Modal,
  Select,
  Tag,
  TextArea,
  TextInput,
  Toggle,
  type Column,
} from '@/cvz/components'
import { IconPlus, IconSettings } from '@/cvz/components/icons'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import { slugificar } from '@/cvz/lib/slug'
import {
  useAtualizarPlanoCfg,
  useCriarPlanoCfg,
  usePlanosCfg,
  type LimitPeriod,
  type PlanoCfg,
  type PlanoCfgEscrita,
} from './dados'

export function AbaPlanos() {
  const { data: itens, isLoading, isError, error, refetch } = usePlanosCfg()
  const { push } = useToast()

  const [modalAberto, setModalAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<PlanoCfg | null>(null)

  function abrirEdicao(item: PlanoCfg) {
    setEmEdicao(item)
    setModalAberto(true)
  }

  function abrirCriacao() {
    setEmEdicao(null)
    setModalAberto(true)
  }

  const colunas: Column<PlanoCfg>[] = [
    { key: 'name', header: 'Nome', mobile: 'title', render: (p) => p.name },
    {
      key: 'limite',
      header: 'Limite de tickets',
      mobile: 'meta',
      render: (p) =>
        p.default_ticket_limit != null
          ? `${p.default_ticket_limit} / ${p.default_limit_period === 'weekly' ? 'semana' : 'mês'}`
          : 'Sem limite',
    },
    {
      key: 'manutencao',
      header: 'Manutenção',
      numeric: true,
      mobile: 'meta',
      render: (p) => (p.monthly_maintenance_minutes != null ? `${p.monthly_maintenance_minutes} min/mês` : '—'),
    },
    {
      key: 'chat_enabled',
      header: 'Chat',
      mobile: 'meta',
      render: (p) => <Tag tone={p.chat_enabled ? 'success' : 'neutral'}>{p.chat_enabled ? 'Sim' : 'Não'}</Tag>,
    },
    {
      key: 'company_count',
      header: 'Empresas',
      numeric: true,
      mobile: 'meta',
      sortBy: (p) => p.company_count,
      render: (p) => p.company_count,
    },
    {
      key: 'is_active',
      header: 'Ativo',
      mobile: 'meta',
      render: (p) => <CampoAtivo item={p} />,
    },
    {
      key: 'editar',
      header: '',
      mobile: 'hidden',
      render: (p) => <IconButton Icon={IconSettings} label={`Editar ${p.name}`} size="sm" bare onClick={() => abrirEdicao(p)} />,
    },
  ]

  if (isError) {
    return <ErrorState description={error instanceof ApiError ? error.detail : undefined} onRetry={() => refetch()} />
  }

  return (
    <div className="cfg-aba">
      <div className="cfg-aba__acao-add">
        <Button Icon={IconPlus} size="sm" onClick={abrirCriacao}>
          Novo plano
        </Button>
      </div>

      <DataTable
        rows={itens ?? []}
        columns={colunas}
        rowKey={(p) => String(p.id)}
        onRowClick={abrirEdicao}
        loading={isLoading}
        empty="Nenhum plano cadastrado."
      />

      <ModalPlano
        open={modalAberto}
        plano={emEdicao}
        onClose={() => setModalAberto(false)}
        onSalvo={(criado) => push({ tone: 'success', title: criado ? 'Plano criado' : 'Plano atualizado' })}
      />
    </div>
  )
}

function CampoAtivo({ item }: { item: PlanoCfg }) {
  const atualizar = useAtualizarPlanoCfg(item.id)
  const { push } = useToast()
  return (
    <Toggle
      checked={item.is_active}
      onChange={(e) => {
        e.stopPropagation()
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
      }}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Plano ${item.name} ${item.is_active ? 'ativo' : 'inativo'}`}
    />
  )
}

interface FormularioPlano extends PlanoCfgEscrita {
  name: string
  slug: string
}

function formularioDe(p: PlanoCfg | null): FormularioPlano {
  if (!p) {
    return {
      name: '',
      slug: '',
      description: '',
      rank: 0,
      default_ticket_limit: null,
      default_limit_period: 'monthly',
      monthly_maintenance_minutes: null,
      chat_enabled: false,
      chat_consumes_quota: false,
    }
  }
  return {
    name: p.name,
    slug: p.slug,
    description: p.description,
    rank: p.rank,
    default_ticket_limit: p.default_ticket_limit,
    default_limit_period: p.default_limit_period,
    monthly_maintenance_minutes: p.monthly_maintenance_minutes,
    chat_enabled: p.chat_enabled,
    chat_consumes_quota: p.chat_consumes_quota,
  }
}

function ModalPlano({
  open,
  plano,
  onClose,
  onSalvo,
}: {
  open: boolean
  plano: PlanoCfg | null
  onClose: () => void
  onSalvo: (criado: boolean) => void
}) {
  const criar = useCriarPlanoCfg()
  const atualizar = useAtualizarPlanoCfg(plano?.id ?? 0)

  const [form, setForm] = useState(() => formularioDe(plano))
  const [erro, setErro] = useState<string | null>(null)
  // `slug` é obrigatório de verdade no `PlanAdminSerializer` (falta ali o
  // `required=False` que Team/Category/Service/Tag têm) — mesma exigência de
  // Company. Deriva do nome enquanto a pessoa não mexer nele à mão.
  const [slugTocado, setSlugTocado] = useState(false)
  // Mesmo ajuste de AbaEquipes: resemear o formulário quando o modal reabre
  // pra outro plano (ou pra criar um novo), sem efeito — durante o render.
  const [planoSemeado, setPlanoSemeado] = useState(plano?.id ?? null)
  if (open && (plano?.id ?? null) !== planoSemeado) {
    setPlanoSemeado(plano?.id ?? null)
    setForm(formularioDe(plano))
    setSlugTocado(false)
    setErro(null)
  }

  function campo<K extends keyof FormularioPlano>(chave: K, valor: FormularioPlano[K]) {
    setForm((f) => ({ ...f, [chave]: valor }))
  }

  function trocarNome(nome: string) {
    setForm((f) => ({ ...f, name: nome, slug: slugTocado ? f.slug : slugificar(nome) }))
  }

  async function salvar() {
    setErro(null)
    if (!form.name.trim()) {
      setErro('Nome é obrigatório.')
      return
    }
    try {
      if (plano) {
        await atualizar.mutateAsync(form)
      } else {
        await criar.mutateAsync(form)
      }
      onSalvo(!plano)
      onClose()
    } catch (e) {
      setErro(e instanceof ApiError ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0]) : 'Não foi possível salvar.')
    }
  }

  const pendente = criar.isPending || atualizar.isPending

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={plano ? `Editar ${plano.name}` : 'Novo plano'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pendente}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pendente}>
            {pendente ? 'Salvando…' : plano ? 'Salvar' : 'Criar plano'}
          </Button>
        </>
      }
    >
      <FormRow columns={1}>
        <TextInput label="Nome" value={form.name} onChange={(e) => trocarNome(e.target.value)} autoFocus />

        <TextInput
          label="Identificador (slug)"
          helper="Usado em URLs internas. Só letras minúsculas, números e hífen."
          value={form.slug}
          onChange={(e) => {
            campo('slug', e.target.value)
            setSlugTocado(true)
          }}
        />

        <TextArea
          label="Descrição"
          rows={2}
          value={form.description ?? ''}
          onChange={(e) => campo('description', e.target.value)}
        />

        <TextInput
          label="Ordem (rank)"
          type="number"
          helper="Maior primeiro na listagem. Não afeta cobrança nem limite."
          value={form.rank ?? 0}
          onChange={(e) => campo('rank', Number(e.target.value))}
        />

        <FormRow columns={2}>
          <TextInput
            label="Limite de tickets (vazio = sem limite)"
            type="number"
            value={form.default_ticket_limit ?? ''}
            onChange={(e) => campo('default_ticket_limit', e.target.value === '' ? null : Number(e.target.value))}
          />
          <Select
            label="Período do limite"
            value={form.default_limit_period ?? 'monthly'}
            onChange={(e) => campo('default_limit_period', e.target.value as LimitPeriod)}
            options={[
              { value: 'weekly', label: 'Semanal' },
              { value: 'monthly', label: 'Mensal' },
            ]}
          />
        </FormRow>

        <TextInput
          label="Minutos de manutenção por mês (vazio = sem franquia)"
          type="number"
          value={form.monthly_maintenance_minutes ?? ''}
          onChange={(e) => campo('monthly_maintenance_minutes', e.target.value === '' ? null : Number(e.target.value))}
        />

        <Field label="Chat">
          <Checkbox
            label="Este plano tem chat"
            checked={form.chat_enabled ?? false}
            onChange={(e) => campo('chat_enabled', e.target.checked)}
          />
        </Field>

        {form.chat_enabled && (
          <Checkbox
            label="Conversa de chat consome a cota de tickets"
            description="Desmarcado, o chat é isento: só tickets abertos contam pro limite do plano."
            checked={form.chat_consumes_quota ?? false}
            onChange={(e) => campo('chat_consumes_quota', e.target.checked)}
          />
        )}

        {plano && <p className="cfg-meta-form">{plano.company_count} empresa(s) neste plano.</p>}

        {erro && <p className="cfg-erro-form">{erro}</p>}
      </FormRow>
    </Modal>
  )
}
