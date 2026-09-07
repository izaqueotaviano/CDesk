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
  Skeleton,
  Tag,
  TextArea,
  TextInput,
  Toggle,
  type Column,
} from '@/cvz/components'
import { IconPlus, IconUser, IconUserPlus } from '@/cvz/components/icons'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { useAgentes } from '@/cvz/tickets/dados'
import { AcoesAgenteCfg } from './AcoesAgenteCfg'
import { ModalAdicionarAgente } from './ModalAdicionarAgente'
import { ModalHistoricoAcessoAgente } from './ModalHistoricoAcessoAgente'
import {
  useAtualizarEquipeCfg,
  useCalendariosCfg,
  useChoicesCfg,
  useCriarEquipeCfg,
  useRosterCfg,
  type AgenteCfg,
  type EquipeCfg,
  type EquipeCfgEscrita,
  type EquipeRosterCfg,
  type Visibilidade,
} from './dados'

const VISIBILIDADES: { value: Visibilidade; label: string }[] = [
  { value: 'company_wide', label: 'Toda a empresa cliente' },
  { value: 'requester_only', label: 'Apenas o solicitante (ex.: Financeiro)' },
]

export function AbaEquipes() {
  const { data: me } = useMe()
  // Todas as ações desta aba (add_agent, invite, reset-password, reset-2fa,
  // sessões, desativar) são `IsAdmin` no backend — `Perm.SETTINGS_MANAGE`.
  // A listagem em si (`roster`) só pede `PANEL_ACCESS`, mas uma tela de
  // "Equipes e agentes" sem NENHUMA ação disponível não serve pra quem não
  // administra; melhor o aviso amigável do que uma tabela morta.
  const podeGerenciar = (me?.permissions ?? []).includes('settings.manage')

  const roster = useRosterCfg()
  const { data: agentes } = useAgentes()
  const { data: choices } = useChoicesCfg()
  const { push } = useToast()

  const [modalEquipeAberto, setModalEquipeAberto] = useState(false)
  const [equipeEmEdicao, setEquipeEmEdicao] = useState<EquipeCfg | null>(null)
  const [equipeParaAdicionarAgente, setEquipeParaAdicionarAgente] = useState<EquipeRosterCfg | null>(null)
  const [agenteHistorico, setAgenteHistorico] = useState<AgenteCfg | null>(null)

  const nomeAgente = useMemo(() => {
    const m = new Map((agentes ?? []).map((a) => [a.id, a.full_name]))
    return (id: number | null) => (id != null ? (m.get(id) ?? `#${id}`) : '—')
  }, [agentes])

  const rotuloPapel = useMemo(() => {
    const m = new Map((choices?.internal_roles ?? []).map((o) => [o.value, o.label]))
    return (papel: string | null) => (papel ? (m.get(papel) ?? papel) : '—')
  }, [choices])

  function abrirEdicaoEquipe(item: EquipeCfg) {
    setEquipeEmEdicao(item)
    setModalEquipeAberto(true)
  }

  function abrirCriacaoEquipe() {
    setEquipeEmEdicao(null)
    setModalEquipeAberto(true)
  }

  const colunasAgente: Column<AgenteCfg>[] = useMemo(
    () => [
      {
        key: 'full_name',
        header: 'Nome',
        mobile: 'title',
        sortBy: (a) => a.full_name,
        render: (a) => (
          <div>
            <div>{a.full_name}</div>
            <span className="cfg-meta-form">{a.email}</span>
          </div>
        ),
      },
      {
        key: 'internal_role',
        header: 'Papel',
        mobile: 'meta',
        render: (a) => <Tag tone="blue">{rotuloPapel(a.internal_role)}</Tag>,
      },
      {
        key: 'invite_status',
        header: 'Convite',
        mobile: 'meta',
        render: (a) =>
          a.invite_status ? (
            <Tag tone={a.invite_status === 'aceito' ? 'success' : 'away'}>
              {a.invite_status === 'aceito' ? 'Aceito' : 'Pendente'}
            </Tag>
          ) : (
            <Tag tone="neutral">Google</Tag>
          ),
      },
      {
        key: 'is_active',
        header: 'Status',
        mobile: 'meta',
        render: (a) => (
          <Tag tone={a.is_active ? 'success' : 'neutral'} dot>
            {a.is_active ? 'Ativo' : 'Inativo'}
          </Tag>
        ),
      },
      {
        key: 'acoes',
        header: '',
        mobile: 'hidden',
        render: (a) => <AcoesAgenteCfg agente={a} onVerHistorico={setAgenteHistorico} />,
      },
    ],
    [rotuloPapel],
  )

  if (me && !podeGerenciar) {
    return (
      <div className="cfg-aba">
        <p>Esta área é restrita a administradores.</p>
      </div>
    )
  }

  if (roster.isError) {
    return (
      <ErrorState
        description={roster.error instanceof ApiError ? roster.error.detail : undefined}
        onRetry={() => roster.refetch()}
      />
    )
  }

  return (
    <div className="cfg-aba">
      <div className="cfg-aba__acao-add">
        <Button Icon={IconPlus} size="sm" onClick={abrirCriacaoEquipe}>
          Nova equipe
        </Button>
      </div>

      {roster.isLoading || !roster.data ? (
        <Skeleton lines={6} />
      ) : (
        <div className="cfg-roster">
          {roster.data.teams.map((equipe) => (
            <div key={equipe.id} className="cfg-roster__equipe">
              <div className="cfg-roster__cabecalho">
                <div className="cfg-roster__cabecalho-info">
                  <div className="cfg-roster__cabecalho-titulo">
                    <strong>{equipe.name}</strong>
                    <Tag tone={equipe.internal_only ? 'away' : 'neutral'}>
                      {equipe.internal_only
                        ? 'Interna (cliente não vê)'
                        : VISIBILIDADES.find((v) => v.value === equipe.visibility)?.label}
                    </Tag>
                    {!equipe.is_active && <Tag tone="neutral">Inativa</Tag>}
                  </div>
                  <span className="cfg-meta-form">
                    Supervisor: {equipe.supervisor_name ?? '—'} · {equipe.ticket_count} ticket(s)
                  </span>
                </div>
                <div className="cfg-roster__cabecalho-acoes">
                  <Button Icon={IconUserPlus} variant="tertiary" size="sm" onClick={() => setEquipeParaAdicionarAgente(equipe)}>
                    Adicionar agente
                  </Button>
                  <CampoAtivoEquipe item={equipe} />
                  <IconButton
                    Icon={IconUser}
                    label={`Editar ${equipe.name}`}
                    size="sm"
                    bare
                    onClick={() => abrirEdicaoEquipe(equipe)}
                  />
                </div>
              </div>

              <DataTable
                rows={equipe.agents}
                columns={colunasAgente}
                rowKey={(a) => String(a.id)}
                density="compact"
                empty="Nenhum agente nesta equipe ainda."
              />
            </div>
          ))}

          <div className="cfg-roster__equipe">
            <div className="cfg-roster__cabecalho">
              <div className="cfg-roster__cabecalho-info">
                <div className="cfg-roster__cabecalho-titulo">
                  <strong>Sem equipe</strong>
                </div>
                <span className="cfg-meta-form">Agentes sem nenhuma equipe vinculada — não enxergam ticket algum.</span>
              </div>
            </div>
            <DataTable
              rows={roster.data.unassigned}
              columns={colunasAgente}
              rowKey={(a) => String(a.id)}
              density="compact"
              empty="Todo agente está em pelo menos uma equipe."
            />
          </div>
        </div>
      )}

      <ModalEquipe
        open={modalEquipeAberto}
        equipe={equipeEmEdicao}
        nomeAgente={nomeAgente}
        onClose={() => setModalEquipeAberto(false)}
        onSalva={(criada) =>
          push({ tone: 'success', title: criada ? 'Equipe criada' : 'Equipe atualizada' })
        }
      />

      <ModalAdicionarAgente
        equipe={equipeParaAdicionarAgente}
        open={equipeParaAdicionarAgente !== null}
        onClose={() => setEquipeParaAdicionarAgente(null)}
      />

      <ModalHistoricoAcessoAgente agente={agenteHistorico} onClose={() => setAgenteHistorico(null)} />
    </div>
  )
}

function CampoAtivoEquipe({ item }: { item: EquipeCfg }) {
  const atualizar = useAtualizarEquipeCfg(item.id)
  const { push } = useToast()
  return (
    <Toggle
      checked={item.is_active}
      onChange={(e) => {
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
