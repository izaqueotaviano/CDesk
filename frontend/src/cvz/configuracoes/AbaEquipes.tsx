import { useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  Combobox,
  DataTable,
  ErrorState,
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
import { IconPlus, IconUser } from '@/cvz/components/icons'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import { useAgentes } from '@/cvz/tickets/dados'
import {
  useAtualizarEquipeCfg,
  useCalendariosCfg,
  useCriarEquipeCfg,
  useEquipesCfg,
  type EquipeCfg,
  type EquipeCfgEscrita,
  type Visibilidade,
} from './dados'

const VISIBILIDADES: { value: Visibilidade; label: string }[] = [
  { value: 'company_wide', label: 'Toda a empresa cliente' },
  { value: 'requester_only', label: 'Apenas o solicitante (ex.: Financeiro)' },
]

export function AbaEquipes() {
  const { data: itens, isLoading, isError, error, refetch } = useEquipesCfg()
  const { data: agentes } = useAgentes()
  const { push } = useToast()

  const [modalAberto, setModalAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<EquipeCfg | null>(null)

  const nomeAgente = useMemo(() => {
    const m = new Map((agentes ?? []).map((a) => [a.id, a.full_name]))
    return (id: number | null) => (id != null ? (m.get(id) ?? `#${id}`) : '—')
  }, [agentes])

  function abrirEdicao(item: EquipeCfg) {
    setEmEdicao(item)
    setModalAberto(true)
  }

  function abrirCriacao() {
    setEmEdicao(null)
    setModalAberto(true)
  }

  const colunas: Column<EquipeCfg>[] = [
    { key: 'name', header: 'Nome', mobile: 'title', render: (e) => e.name },
    {
      key: 'supervisor_name',
      header: 'Supervisor',
      mobile: 'meta',
      render: (e) => e.supervisor_name ?? '—',
    },
    {
      key: 'visibility',
      header: 'Visibilidade',
      mobile: 'meta',
      render: (e) => (
        <Tag tone={e.internal_only ? 'away' : 'neutral'}>
          {e.internal_only
            ? 'Interna (cliente não vê)'
            : VISIBILIDADES.find((v) => v.value === e.visibility)?.label}
        </Tag>
      ),
    },
    {
      key: 'agent_count',
      header: 'Agentes',
      numeric: true,
      mobile: 'meta',
      sortBy: (e) => e.agent_count,
      render: (e) => e.agent_count,
    },
    {
      key: 'ticket_count',
      header: 'Tickets',
      numeric: true,
      mobile: 'meta',
      sortBy: (e) => e.ticket_count,
      render: (e) => e.ticket_count,
    },
    {
      key: 'is_active',
      header: 'Ativa',
      mobile: 'meta',
      render: (e) => <CampoAtivo item={e} />,
    },
    {
      key: 'editar',
      header: '',
      mobile: 'hidden',
      render: (e) => <IconButton Icon={IconUser} label={`Editar ${e.name}`} size="sm" bare onClick={() => abrirEdicao(e)} />,
    },
  ]

  if (isError) {
    return <ErrorState description={error instanceof ApiError ? error.detail : undefined} onRetry={() => refetch()} />
  }

  return (
    <div className="cfg-aba">
      <div className="cfg-aba__acao-add">
        <Button Icon={IconPlus} size="sm" onClick={abrirCriacao}>
          Nova equipe
        </Button>
      </div>

      <DataTable
        rows={itens ?? []}
        columns={colunas}
        rowKey={(e) => String(e.id)}
        onRowClick={abrirEdicao}
        loading={isLoading}
        empty="Nenhuma equipe cadastrada."
      />

      <ModalEquipe
        open={modalAberto}
        equipe={emEdicao}
        nomeAgente={nomeAgente}
        onClose={() => setModalAberto(false)}
        onSalva={(criada) =>
          push({ tone: 'success', title: criada ? 'Equipe criada' : 'Equipe atualizada' })
        }
      />
    </div>
  )
}

function CampoAtivo({ item }: { item: EquipeCfg }) {
  const atualizar = useAtualizarEquipeCfg(item.id)
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
      aria-label={`Equipe ${item.name} ${item.is_active ? 'ativa' : 'inativa'}`}
    />
  )
}

function formularioDe(e: EquipeCfg | null): EquipeCfgEscrita & { name: string } {
  if (!e) {
    return {
      name: '',
      supervisor: null,
      visibility: 'company_wide',
      mask_subject_for_others: true,
      internal_only: false,
      chat_calendar: null,
      notification_email: '',
      description: '',
    }
  }
  return {
    name: e.name,
    supervisor: e.supervisor,
    visibility: e.visibility,
    mask_subject_for_others: e.mask_subject_for_others,
    internal_only: e.internal_only,
    chat_calendar: e.chat_calendar,
    notification_email: e.notification_email,
    description: e.description,
  }
}

function ModalEquipe({
  open,
  equipe,
  nomeAgente,
  onClose,
  onSalva,
}: {
  open: boolean
  equipe: EquipeCfg | null
  nomeAgente: (id: number | null) => string
  onClose: () => void
  onSalva: (criada: boolean) => void
}) {
  const { data: agentes } = useAgentes()
  const { data: calendarios } = useCalendariosCfg()
  const criar = useCriarEquipeCfg()
  const atualizar = useAtualizarEquipeCfg(equipe?.id ?? 0)

  const [form, setForm] = useState(() => formularioDe(equipe))
  const [erro, setErro] = useState<string | null>(null)
  // Reabrir o modal (criar depois editar, ou trocar de linha) precisa
  // resemear o formulário — sem isso ficaria mostrando os dados da equipe
  // anterior. Ajuste durante o render, não em efeito: compara contra o id
  // (ou null) já semeado da última vez.
  const [equipeSemeada, setEquipeSemeada] = useState(equipe?.id ?? null)
  if (open && (equipe?.id ?? null) !== equipeSemeada) {
    setEquipeSemeada(equipe?.id ?? null)
    setForm(formularioDe(equipe))
    setErro(null)
  }

  const opcoesAgente = useMemo(
    () => (agentes ?? []).map((a) => ({ value: String(a.id), label: a.full_name, description: a.email })),
    [agentes],
  )

  function campo<K extends keyof typeof form>(chave: K, valor: (typeof form)[K]) {
    setForm((f) => ({ ...f, [chave]: valor }))
  }

  async function salvar() {
    setErro(null)
    if (!form.name.trim()) {
      setErro('Nome é obrigatório.')
      return
    }
    try {
      if (equipe) {
        await atualizar.mutateAsync(form)
      } else {
        await criar.mutateAsync(form)
      }
      onSalva(!equipe)
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
      title={equipe ? `Editar ${equipe.name}` : 'Nova equipe'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pendente}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pendente}>
            {pendente ? 'Salvando…' : equipe ? 'Salvar' : 'Criar equipe'}
          </Button>
        </>
      }
    >
      <FormRow columns={1}>
        <TextInput label="Nome" value={form.name} onChange={(e) => campo('name', e.target.value)} autoFocus />

        <Combobox
          label="Supervisor"
          placeholder="Sem supervisor"
          emptyLabel="Nenhum agente com esse nome."
          options={opcoesAgente}
          value={form.supervisor == null ? null : String(form.supervisor)}
          onChange={(v) => campo('supervisor', v ? Number(v) : null)}
        />

        <Select
          label="Visibilidade"
          helper="Quem, do lado do cliente, enxerga os tickets desta equipe."
          value={form.visibility ?? 'company_wide'}
          onChange={(e) => campo('visibility', e.target.value as Visibilidade)}
          options={VISIBILIDADES}
        />

        <Checkbox
          label="Mascarar assunto para quem não é da equipe"
          description="Além do nome do solicitante, esconde também o assunto do ticket de quem não atende esta equipe."
          checked={form.mask_subject_for_others ?? true}
          onChange={(e) => campo('mask_subject_for_others', e.target.checked)}
        />

        <Checkbox
          label="Equipe interna"
          description="O cliente não abre nem enxerga estes tickets — mais forte que a visibilidade acima. Desmarcar revela ao cliente o histórico já existente da equipe."
          checked={form.internal_only ?? false}
          onChange={(e) => campo('internal_only', e.target.checked)}
        />

        <Select
          label="Calendário do chat"
          helper="Horário de expediente usado para saber se o chat está fora do ar."
          value={form.chat_calendar == null ? '' : String(form.chat_calendar)}
          onChange={(e) => campo('chat_calendar', e.target.value ? Number(e.target.value) : null)}
          options={[
            { value: '', label: 'Sem calendário' },
            ...(calendarios ?? []).map((c) => ({ value: String(c.id), label: c.name })),
          ]}
        />

        <TextInput
          label="E-mail de notificação"
          type="email"
          helper="Opcional — recebe cópia de eventos da equipe além da notificação individual do agente."
          value={form.notification_email ?? ''}
          onChange={(e) => campo('notification_email', e.target.value)}
        />

        <TextArea
          label="Descrição"
          rows={2}
          value={form.description ?? ''}
          onChange={(e) => campo('description', e.target.value)}
        />

        {equipe && (
          <p className="cfg-meta-form">
            Supervisor atual: {nomeAgente(equipe.supervisor)} · {equipe.agent_count} agente(s) · {equipe.ticket_count} ticket(s)
          </p>
        )}

        {erro && <p className="cfg-erro-form">{erro}</p>}
      </FormRow>
    </Modal>
  )
}
