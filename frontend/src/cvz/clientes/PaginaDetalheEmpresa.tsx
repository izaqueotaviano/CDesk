import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button,
  DataTable,
  ErrorState,
  Field,
  FormActions,
  FormRow,
  FormSection,
  IconUserPlus,
  PageHeader,
  Progress,
  Select,
  Skeleton,
  StatCard,
  Tabs,
  Tag,
  TextArea,
  TextInput,
  Toggle,
  useToast,
  type Column,
} from '@/cvz/components'
import { ApiError } from '@/api/client'
import { ModalConvidarUsuario } from './ModalConvidarUsuario'
import {
  useAtualizarEmpresa,
  useEmpresa,
  usePlanos,
  useUsuariosDaEmpresa,
  type EmpresaEscrita,
  type LimitPeriod,
} from './dados'
import './clientes.scss'

/** Campos editáveis do formulário — espelha `EmpresaEscrita`, mas com
 *  `domains` sempre presente (nunca undefined) pra simplificar o editor de chips. */
interface FormularioEmpresa extends EmpresaEscrita {
  domains: string[]
}

function formularioDe(e: {
  name: string
  legal_name: string
  tax_id: string | null
  slug: string
  plan: number
  is_active: boolean
  timezone: string
  ticket_limit: number | null
  limit_period: LimitPeriod | '' | null
  notes: string
  domains: string[]
  contract_started_at: string | null
  contract_ended_at: string | null
}): FormularioEmpresa {
  return {
    name: e.name,
    legal_name: e.legal_name,
    tax_id: e.tax_id ?? '',
    slug: e.slug,
    plan: e.plan,
    is_active: e.is_active,
    timezone: e.timezone,
    ticket_limit: e.ticket_limit,
    limit_period: e.limit_period ?? '',
    notes: e.notes,
    domains: e.domains,
    contract_started_at: e.contract_started_at,
    contract_ended_at: e.contract_ended_at,
  }
}

function toneDoUso(pct: number): 'blue' | 'away' | 'danger' {
  if (pct >= 100) return 'danger'
  if (pct >= 75) return 'away'
  return 'blue'
}

export function PaginaDetalheEmpresa() {
  const params = useParams<{ id: string }>()
  const id = Number(params.id)
  const navigate = useNavigate()
  const { push } = useToast()

  const { data: empresa, isLoading, isError, error, refetch } = useEmpresa(id)
  const { data: planos } = usePlanos()
  const atualizar = useAtualizarEmpresa(id)

  const [form, setForm] = useState<FormularioEmpresa | null>(null)
  const [novoDominio, setNovoDominio] = useState('')
  const [abaAtiva, setAbaAtiva] = useState('geral')
  const [modalConvidarAberto, setModalConvidarAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Só inicializa o form quando a empresa chega — depois disso, edições locais
  // não são sobrescritas por um refetch em segundo plano. Ajuste de estado
  // durante a renderização (não em efeito): assim que `empresa` aparece pela
  // primeira vez, semeia o form nesse mesmo ciclo de render.
  if (empresa && !form) setForm(formularioDe(empresa))

  const { data: usuarios, isLoading: carregandoUsuarios } = useUsuariosDaEmpresa(
    id,
    abaAtiva === 'usuarios',
  )

  function atualizarCampo<K extends keyof FormularioEmpresa>(campo: K, valor: FormularioEmpresa[K]) {
    setForm((f) => (f ? { ...f, [campo]: valor } : f))
  }

  function adicionarDominio() {
    const d = novoDominio.trim().toLowerCase()
    if (!d || !form) return
    if (form.domains.includes(d)) {
      setNovoDominio('')
      return
    }
    atualizarCampo('domains', [...form.domains, d])
    setNovoDominio('')
  }

  async function salvar() {
    if (!form) return
    setErro(null)
    try {
      await atualizar.mutateAsync({
        ...form,
        tax_id: form.tax_id || null,
        limit_period: form.limit_period || null,
      })
      push({ tone: 'success', title: 'Empresa atualizada' })
    } catch (e) {
      setErro(e instanceof ApiError ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0]) : 'Não foi possível salvar.')
    }
  }

  const colunasUsuarios: Column<NonNullable<typeof usuarios>[number]>[] = [
    {
      key: 'full_name',
      header: 'Nome',
      mobile: 'title',
      sortBy: (u) => u.full_name,
      render: (u) => (
        <div>
          <div>{u.full_name}</div>
          <span className="clientes-meta">{u.email}</span>
        </div>
      ),
    },
    {
      key: 'client_role',
      header: 'Papel',
      mobile: 'meta',
      render: (u) => <Tag tone="blue">{u.client_role === 'owner' ? 'Responsável' : 'Usuário'}</Tag>,
    },
    {
      key: 'invite_status',
      header: 'Convite',
      mobile: 'meta',
      render: (u) => (
        <Tag tone={u.invite_status === 'accepted' ? 'success' : 'neutral'}>
          {u.invite_status === 'accepted' ? 'Aceito' : u.invite_status || 'Pendente'}
        </Tag>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      mobile: 'meta',
      render: (u) => (
        <Tag tone={u.is_active ? 'success' : 'neutral'} dot>
          {u.is_active ? 'Ativo' : 'Inativo'}
        </Tag>
      ),
    },
  ]

  if (isLoading || !form) {
    return (
      <>
        <PageHeader title="Carregando…" breadcrumbs={[{ label: 'Clientes', onClick: () => navigate('/clientes') }]} />
        <Skeleton lines={6} />
      </>
    )
  }

  if (isError || !empresa) {
    return (
      <ErrorState
        description={error instanceof ApiError ? error.detail : undefined}
        onRetry={() => refetch()}
      />
    )
  }

  const quotaPct = empresa.quota_usage.limit ? (empresa.quota_usage.used / empresa.quota_usage.limit) * 100 : 0
  const manutencaoPct = empresa.maintenance_usage.limit_minutes
    ? (empresa.maintenance_usage.used_minutes / empresa.maintenance_usage.limit_minutes) * 100
    : 0

  return (
    <>
      <PageHeader
        title={empresa.name}
        titleAdornment={
          <Tag tone={empresa.is_active ? 'success' : 'neutral'} dot>
            {empresa.is_active ? 'Ativa' : 'Inativa'}
          </Tag>
        }
        description={empresa.legal_name || undefined}
        breadcrumbs={[
          { label: 'Clientes', onClick: () => navigate('/clientes') },
          { label: empresa.name },
        ]}
      />

      <FormRow columns={3}>
        <div>
          <Progress
            label="Tickets no período"
            value={empresa.quota_usage.limit ? Math.min(100, quotaPct) : undefined}
            tone={toneDoUso(quotaPct)}
          />
          <p className="clientes-meta--espacada">
            {empresa.quota_usage.used} {empresa.quota_usage.limit != null ? `/ ${empresa.quota_usage.limit}` : '(sem limite)'}
          </p>
        </div>
        {empresa.maintenance_usage.limit_minutes != null && (
          <div>
            <Progress
              label="Manutenção (min)"
              value={Math.min(100, manutencaoPct)}
              tone={toneDoUso(manutencaoPct)}
            />
            <p className="clientes-meta--espacada">
              {empresa.maintenance_usage.used_minutes} / {empresa.maintenance_usage.limit_minutes} min
            </p>
          </div>
        )}
        {/* StatCard do catálogo, não um <span>/<p> montado à mão — mesmo
            rótulo+valor que os outros dois blocos já usam via Progress. */}
        <StatCard label="Usuários" value={String(empresa.user_count)} />
      </FormRow>

      <div style={{ marginTop: 24 }}>
        <Tabs
          items={[
            {
              id: 'geral',
              label: 'Visão geral',
              content: (
                <>
                  <FormSection title="Identificação">
                    <FormRow columns={2}>
                      <TextInput
                        label="Nome"
                        value={form.name}
                        onChange={(e) => atualizarCampo('name', e.target.value)}
                      />
                      <TextInput
                        label="Razão social"
                        value={form.legal_name}
                        onChange={(e) => atualizarCampo('legal_name', e.target.value)}
                      />
                    </FormRow>
                    <FormRow columns={2}>
                      <TextInput
                        label="CNPJ / documento"
                        value={form.tax_id ?? ''}
                        onChange={(e) => atualizarCampo('tax_id', e.target.value)}
                      />
                      <TextInput
                        label="Identificador (slug)"
                        value={form.slug}
                        onChange={(e) => atualizarCampo('slug', e.target.value)}
                      />
                    </FormRow>
                  </FormSection>

                  <FormSection title="Plano e limites">
                    <FormRow columns={2}>
                      <Select
                        label="Plano"
                        value={String(form.plan)}
                        onChange={(e) => atualizarCampo('plan', Number(e.target.value))}
                        options={(planos ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
                      />
                      <Field label="Status da conta">
                        <Toggle
                          label={form.is_active ? 'Ativa' : 'Inativa'}
                          checked={form.is_active ?? true}
                          onChange={(e) => atualizarCampo('is_active', e.target.checked)}
                        />
                      </Field>
                    </FormRow>
                    <FormRow columns={2}>
                      <TextInput
                        label="Limite de tickets (vazio = usar o do plano)"
                        type="number"
                        value={form.ticket_limit ?? ''}
                        onChange={(e) =>
                          atualizarCampo('ticket_limit', e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                      <Select
                        label="Período do limite"
                        value={form.limit_period ?? ''}
                        onChange={(e) => atualizarCampo('limit_period', e.target.value as LimitPeriod | '')}
                        options={[
                          { value: '', label: `Usar o do plano (${empresa.effective_period || '—'})` },
                          { value: 'weekly', label: 'Semanal' },
                          { value: 'monthly', label: 'Mensal' },
                        ]}
                      />
                    </FormRow>
                  </FormSection>

                  <FormSection title="Domínios" description="Endereços de e-mail dos usuários dessa empresa precisam terminar em um destes domínios.">
                    <div className="clientes-domain-list">
                      {form.domains.length === 0 && (
                        <span className="clientes-vazio-inline">Nenhum domínio cadastrado.</span>
                      )}
                      {form.domains.map((d) => (
                        <Tag
                          key={d}
                          onRemove={() =>
                            atualizarCampo(
                              'domains',
                              form.domains.filter((x) => x !== d),
                            )
                          }
                        >
                          {d}
                        </Tag>
                      ))}
                    </div>
                    <FormRow columns={2}>
                      <TextInput
                        placeholder="dominio.com.br"
                        value={novoDominio}
                        onChange={(e) => setNovoDominio(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            adicionarDominio()
                          }
                        }}
                      />
                      <Button variant="tertiary" onClick={adicionarDominio}>
                        Adicionar domínio
                      </Button>
                    </FormRow>
                  </FormSection>

                  <FormSection title="Anotações internas">
                    <TextArea
                      value={form.notes}
                      onChange={(e) => atualizarCampo('notes', e.target.value)}
                      rows={3}
                    />
                  </FormSection>

                  {erro && <p className="clientes-erro-form">{erro}</p>}

                  <FormActions>
                    <Button onClick={salvar} disabled={atualizar.isPending}>
                      {atualizar.isPending ? 'Salvando…' : 'Salvar alterações'}
                    </Button>
                  </FormActions>
                </>
              ),
            },
            {
              id: 'usuarios',
              label: 'Usuários',
              count: empresa.user_count,
              content: (
                <>
                  <FormActions>
                    <Button Icon={IconUserPlus} variant="tertiary" onClick={() => setModalConvidarAberto(true)}>
                      Convidar usuário
                    </Button>
                  </FormActions>
                  <DataTable
                    rows={usuarios ?? []}
                    columns={colunasUsuarios}
                    rowKey={(u) => String(u.id)}
                    loading={carregandoUsuarios}
                    empty="Nenhum usuário cadastrado nessa empresa ainda."
                  />
                </>
              ),
            },
          ]}
          onChange={setAbaAtiva}
        />
      </div>

      <ModalConvidarUsuario
        empresaId={id}
        open={modalConvidarAberto}
        onClose={() => setModalConvidarAberto(false)}
      />
    </>
  )
}
