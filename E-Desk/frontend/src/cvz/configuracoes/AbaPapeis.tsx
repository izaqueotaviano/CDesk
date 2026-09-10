import { useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  ErrorState,
  FormRow,
  IconButton,
  Modal,
  Select,
  TextArea,
  TextInput,
  Toggle,
  type Column,
} from '@/cvz/components'
import { IconPlus, IconSettings, IconTrash } from '@/cvz/components/icons'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import { slugificar } from '@/cvz/lib/slug'
import {
  useAtualizarPapelCfg,
  useChoicesCfg,
  useCriarPapelCfg,
  useExcluirPapelCfg,
  usePapeisCfg,
  type PapelCfg,
  type PapelCfgEscrita,
  type PermissaoCatalogo,
} from './dados'

// O backend agrupa o catálogo pelo prefixo do próprio valor (ver
// `rbac.permission_catalog`) — aqui só traduz cada prefixo pra um rótulo
// legível. Um grupo novo (permissão com prefixo inédito) cai no fallback e
// aparece sozinho, sem quebrar a tela.
const ROTULOS_GRUPO: Record<string, string> = {
  panel: 'Painel',
  ticket: 'Tickets',
  chat: 'Chat',
  kanban: 'Kanban',
  company: 'Empresas e clientes',
  report: 'Relatórios',
  knowledge: 'Base de conhecimento',
  macro: 'Macros',
  settings: 'Configurações do sistema',
  user: 'Usuários e equipes',
  announcement: 'Avisos',
  audit: 'Auditoria e LGPD',
  role: 'Papéis personalizados',
  portal: 'Portal do cliente',
}

function agruparPermissoes(itens: PermissaoCatalogo[]) {
  const grupos = new Map<string, PermissaoCatalogo[]>()
  for (const p of itens) {
    if (!grupos.has(p.group)) grupos.set(p.group, [])
    grupos.get(p.group)!.push(p)
  }
  return [...grupos.entries()].map(([grupo, permissoes]) => ({
    grupo,
    rotulo: ROTULOS_GRUPO[grupo] ?? grupo,
    permissoes,
  }))
}

export function AbaPapeis() {
  const { data: itens, isLoading, isError, error, refetch } = usePapeisCfg()
  const { data: choices } = useChoicesCfg()
  const excluir = useExcluirPapelCfg()
  const { push } = useToast()

  const [modalAberto, setModalAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<PapelCfg | null>(null)
  const [paraExcluir, setParaExcluir] = useState<PapelCfg | null>(null)

  const rotuloBase = useMemo(() => {
    const m = new Map((choices?.internal_roles ?? []).map((o) => [o.value, o.label]))
    return (valor: string) => m.get(valor) ?? valor
  }, [choices])

  const rotuloEscopo = useMemo(() => {
    const m = new Map((choices?.ticket_scopes ?? []).map((o) => [o.value, o.label]))
    return (valor: string) => m.get(valor) ?? valor
  }, [choices])

  function abrirEdicao(item: PapelCfg) {
    setEmEdicao(item)
    setModalAberto(true)
  }

  function abrirCriacao() {
    setEmEdicao(null)
    setModalAberto(true)
  }

  const colunas: Column<PapelCfg>[] = [
    { key: 'name', header: 'Nome', mobile: 'title', render: (p) => p.name },
    {
      key: 'base_role',
      header: 'Papel base',
      mobile: 'meta',
      render: (p) => rotuloBase(p.base_role),
    },
    {
      key: 'ticket_scope',
      header: 'Escopo de tickets',
      mobile: 'meta',
      render: (p) => (p.ticket_scope ? rotuloEscopo(p.ticket_scope) : 'Padrão do papel base'),
    },
    {
      key: 'permissions',
      header: 'Permissões',
      numeric: true,
      mobile: 'meta',
      sortBy: (p) => p.permissions.length,
      render: (p) => p.permissions.length,
    },
    {
      key: 'user_count',
      header: 'Usuários',
      numeric: true,
      mobile: 'meta',
      sortBy: (p) => p.user_count,
      render: (p) => p.user_count,
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
    {
      key: 'excluir',
      header: '',
      mobile: 'hidden',
      render: (p) => (
        <IconButton
          Icon={IconTrash}
          label={`Excluir ${p.name}`}
          size="sm"
          bare
          onClick={(e) => {
            e.stopPropagation()
            setParaExcluir(p)
          }}
        />
      ),
    },
  ]

  if (isError) {
    return <ErrorState description={error instanceof ApiError ? error.detail : undefined} onRetry={() => refetch()} />
  }

  return (
    <div className="cfg-aba">
      <div className="cfg-aba__acao-add">
        <Button Icon={IconPlus} size="sm" onClick={abrirCriacao}>
          Novo papel
        </Button>
      </div>

      <DataTable
        rows={itens ?? []}
        columns={colunas}
        rowKey={(p) => String(p.id)}
        onRowClick={abrirEdicao}
        loading={isLoading}
        empty="Nenhum papel personalizado cadastrado."
      />

      <ModalPapel
        open={modalAberto}
        papel={emEdicao}
        onClose={() => setModalAberto(false)}
        onSalvo={(criado) => push({ tone: 'success', title: criado ? 'Papel criado' : 'Papel atualizado' })}
      />

      <ConfirmDialog
        open={!!paraExcluir}
        onClose={() => setParaExcluir(null)}
        onConfirm={async () => {
          if (!paraExcluir) return
          try {
            await excluir.mutateAsync(paraExcluir.id)
            push({ tone: 'success', title: 'Papel excluído' })
          } catch (e) {
            push({
              tone: 'danger',
              title: 'Não foi possível excluir',
              description: e instanceof ApiError ? e.detail : 'O papel pode estar em uso.',
            })
          }
        }}
        title={`Excluir "${paraExcluir?.name}"?`}
        description="Só é possível excluir um papel sem usuários — mova-os antes, ou desative o papel em vez de excluir."
        confirmLabel="Excluir"
        danger
      />
    </div>
  )
}

function CampoAtivo({ item }: { item: PapelCfg }) {
  const atualizar = useAtualizarPapelCfg(item.id)
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
      aria-label={`Papel ${item.name} ${item.is_active ? 'ativo' : 'inativo'}`}
    />
  )
}

interface FormularioPapel extends PapelCfgEscrita {
  name: string
  slug: string
  base_role: string
}

function formularioDe(p: PapelCfg | null, baseRolePadrao: string): FormularioPapel {
  if (!p) {
    return {
      name: '',
      slug: '',
      description: '',
      base_role: baseRolePadrao,
      permissions: [],
      ticket_scope: '',
      is_active: true,
    }
  }
  return {
    name: p.name,
    slug: p.slug,
    description: p.description,
    base_role: p.base_role,
    permissions: p.permissions,
    ticket_scope: p.ticket_scope,
    is_active: p.is_active,
  }
}

function ModalPapel({
  open,
  papel,
  onClose,
  onSalvo,
}: {
  open: boolean
  papel: PapelCfg | null
  onClose: () => void
  onSalvo: (criado: boolean) => void
}) {
  const { data: choices } = useChoicesCfg()
  const criar = useCriarPapelCfg()
  const atualizar = useAtualizarPapelCfg(papel?.id ?? 0)

  const baseRolePadrao = choices?.internal_roles[0]?.value ?? 'agent'
  const [form, setForm] = useState(() => formularioDe(papel, baseRolePadrao))
  const [erro, setErro] = useState<string | null>(null)
  // Mesma exigência de Plan/Company: `slug` é `SlugField` sem `blank=True`
  // no model, então o serializer padrão do DRF o marca como obrigatório.
  const [slugTocado, setSlugTocado] = useState(false)
  // Resemear ao reabrir (criar depois editar, ou trocar de papel) — durante
  // o render, sem efeito, como em toda outra aba desta tela.
  const [papelSemeado, setPapelSemeado] = useState(papel?.id ?? null)
  if (open && (papel?.id ?? null) !== papelSemeado) {
    setPapelSemeado(papel?.id ?? null)
    setForm(formularioDe(papel, baseRolePadrao))
    setSlugTocado(false)
    setErro(null)
  }

  const grupos = useMemo(() => agruparPermissoes(choices?.permissions ?? []), [choices])
  const rotuloEscopoPadrao = useMemo(() => {
    const base = form.base_role ?? baseRolePadrao
    const escopo = choices?.role_default_scopes?.[base]
    const rotulo = choices?.ticket_scopes.find((o) => o.value === escopo)?.label
    return rotulo ?? null
  }, [choices, form.base_role, baseRolePadrao])

  function campo<K extends keyof FormularioPapel>(chave: K, valor: FormularioPapel[K]) {
    setForm((f) => ({ ...f, [chave]: valor }))
  }

  function trocarNome(nome: string) {
    setForm((f) => ({ ...f, name: nome, slug: slugTocado ? f.slug : slugificar(nome) }))
  }

  function alternarPermissao(valor: string) {
    setForm((f) => {
      const atuais = f.permissions ?? []
      return {
        ...f,
        permissions: atuais.includes(valor) ? atuais.filter((p) => p !== valor) : [...atuais, valor],
      }
    })
  }

  async function salvar() {
    setErro(null)
    if (!form.name.trim()) {
      setErro('Nome é obrigatório.')
      return
    }
    try {
      if (papel) {
        await atualizar.mutateAsync(form)
      } else {
        await criar.mutateAsync(form)
      }
      onSalvo(!papel)
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
      title={papel ? `Editar ${papel.name}` : 'Novo papel'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pendente}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pendente}>
            {pendente ? 'Salvando…' : papel ? 'Salvar' : 'Criar papel'}
          </Button>
        </>
      }
    >
      <FormRow columns={1}>
        <FormRow columns={2}>
          <TextInput label="Nome" value={form.name} onChange={(e) => trocarNome(e.target.value)} autoFocus />
          <TextInput
            label="Identificador (slug)"
            helper="Usado em URLs internas — só letras minúsculas, números e hífen."
            value={form.slug}
            onChange={(e) => {
              campo('slug', e.target.value)
              setSlugTocado(true)
            }}
          />
        </FormRow>

        <TextArea
          label="Descrição"
          rows={2}
          value={form.description ?? ''}
          onChange={(e) => campo('description', e.target.value)}
        />

        <FormRow columns={2}>
          <Select
            label="Papel base"
            helper="De qual papel embutido este deriva — só documenta a intenção, não soma permissões dele."
            value={form.base_role}
            onChange={(e) => campo('base_role', e.target.value)}
            options={choices?.internal_roles ?? []}
          />
          <Select
            label="Escopo de tickets"
            helper={
              rotuloEscopoPadrao
                ? `Em branco, usa o padrão do papel base: ${rotuloEscopoPadrao}.`
                : 'Em branco, usa o padrão do papel base.'
            }
            value={form.ticket_scope ?? ''}
            onChange={(e) => campo('ticket_scope', e.target.value)}
            options={[{ value: '', label: 'Padrão do papel base' }, ...(choices?.ticket_scopes ?? [])]}
          />
        </FormRow>

        <div className="cfg-permissoes">
          {grupos.map(({ grupo, rotulo, permissoes }) => (
            <div className="cfg-permissoes__grupo" key={grupo}>
              <span className="cfg-permissoes__titulo">{rotulo}</span>
              <div className="cfg-permissoes__grid">
                {permissoes.map((p) => (
                  <Checkbox
                    key={p.value}
                    label={p.label}
                    checked={(form.permissions ?? []).includes(p.value)}
                    onChange={() => alternarPermissao(p.value)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {papel && <p className="cfg-meta-form">{papel.user_count} usuário(s) usam este papel.</p>}

        {erro && <p className="cfg-erro-form">{erro}</p>}
      </FormRow>
    </Modal>
  )
}
