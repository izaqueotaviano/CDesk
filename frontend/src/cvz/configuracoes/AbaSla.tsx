import { useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  DataTable,
  ErrorState,
  Field,
  FormRow,
  Modal,
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
  useAtualizarSlaPolicyCfg,
  useCriarSlaPolicyCfg,
  useEquipesCfg,
  usePlanosCfg,
  useSlaPoliciesCfg,
  type SlaPolicyCfg,
} from './dados'

/** Minutos ↔ texto "Xh Ymin", só pra digitar sem fazer conta de cabeça. */
function minutosParaTexto(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m}min`
  return m ? `${h}h${m}min` : `${h}h`
}

export function AbaSla() {
  const { data: itens, isLoading, isError, error, refetch } = useSlaPoliciesCfg()
  const { data: planos } = usePlanosCfg()
  const { data: equipes } = useEquipesCfg()
  const { push } = useToast()
  const [modalAberto, setModalAberto] = useState(false)

  const nomePlano = useMemo(() => {
    const m = new Map((planos ?? []).map((p) => [p.id, p.name]))
    return (id: number | null) => (id != null ? (m.get(id) ?? `#${id}`) : 'Todos os planos')
  }, [planos])
  const nomeEquipe = useMemo(() => {
    const m = new Map((equipes ?? []).map((e) => [e.id, e.name]))
    return (id: number | null) => (id != null ? (m.get(id) ?? `#${id}`) : 'Todas as equipes')
  }, [equipes])

  const colunas: Column<SlaPolicyCfg>[] = [
    { key: 'name', header: 'Nome', mobile: 'title', render: (p) => p.name },
    {
      key: 'escopo',
      header: 'Vale para',
      mobile: 'subtitle',
      render: (p) => (
        <span>
          {nomePlano(p.plan)} · {nomeEquipe(p.team)}
        </span>
      ),
    },
    {
      key: 'first_response_minutes',
      header: '1ª resposta',
      numeric: true,
      mobile: 'meta',
      sortBy: (p) => p.first_response_minutes,
      render: (p) => minutosParaTexto(p.first_response_minutes),
    },
    {
      key: 'resolution_minutes',
      header: 'Resolução',
      numeric: true,
      mobile: 'meta',
      sortBy: (p) => p.resolution_minutes,
      render: (p) => minutosParaTexto(p.resolution_minutes),
    },
    {
      key: 'use_business_hours',
      header: 'Horário comercial',
      mobile: 'meta',
      render: (p) => <Tag tone={p.use_business_hours ? 'blue' : 'neutral'}>{p.use_business_hours ? 'Sim' : 'Não'}</Tag>,
    },
    {
      key: 'is_active',
      header: 'Ativa',
      mobile: 'meta',
      render: (p) => <CampoAtivo item={p} />,
    },
  ]

  if (isError) {
    return <ErrorState description={error instanceof ApiError ? error.detail : undefined} onRetry={() => refetch()} />
  }

  return (
    <div className="cfg-aba">
      <div className="cfg-aba__acao-add">
        <Button Icon={IconPlus} size="sm" onClick={() => setModalAberto(true)}>
          Nova política de SLA
        </Button>
      </div>

      <DataTable
        rows={itens ?? []}
        columns={colunas}
        rowKey={(p) => String(p.id)}
        loading={isLoading}
        empty="Nenhuma política de SLA cadastrada. Os tickets não têm prazo até que exista uma."
      />

      <ModalNovaPolitica
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        onCriada={() => push({ tone: 'success', title: 'Política de SLA criada' })}
      />
    </div>
  )
}

function CampoAtivo({ item }: { item: SlaPolicyCfg }) {
  const atualizar = useAtualizarSlaPolicyCfg(item.id)
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
      aria-label={`Política ${item.name} ${item.is_active ? 'ativa' : 'inativa'}`}
    />
  )
}

function ModalNovaPolitica({
  open,
  onClose,
  onCriada,
}: {
  open: boolean
  onClose: () => void
  onCriada: () => void
}) {
  const { data: planos } = usePlanosCfg()
  const { data: equipes } = useEquipesCfg()
  const criar = useCriarSlaPolicyCfg()

  const [nome, setNome] = useState('')
  const [planoId, setPlanoId] = useState('')
  const [equipeId, setEquipeId] = useState('')
  const [primeiraResposta, setPrimeiraResposta] = useState('60')
  const [resolucao, setResolucao] = useState('480')
  const [horarioComercial, setHorarioComercial] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  function fechar() {
    setNome('')
    setPlanoId('')
    setEquipeId('')
    setPrimeiraResposta('60')
    setResolucao('480')
    setHorarioComercial(true)
    setErro(null)
    onClose()
  }

  async function enviar() {
    setErro(null)
    if (!nome.trim() || !primeiraResposta || !resolucao) {
      setErro('Nome e os dois prazos são obrigatórios.')
      return
    }
    try {
      await criar.mutateAsync({
        name: nome.trim(),
        plan: planoId ? Number(planoId) : null,
        team: equipeId ? Number(equipeId) : null,
        first_response_minutes: Number(primeiraResposta),
        resolution_minutes: Number(resolucao),
        use_business_hours: horarioComercial,
      })
      onCriada()
      fechar()
    } catch (e) {
      setErro(e instanceof ApiError ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0]) : 'Não foi possível criar.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Nova política de SLA"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={fechar} disabled={criar.isPending}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={criar.isPending}>
            {criar.isPending ? 'Criando…' : 'Criar política'}
          </Button>
        </>
      }
    >
      <FormRow columns={1}>
        <TextInput label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />

        <Select
          label="Plano"
          helper="Vazio = vale pra qualquer plano, mas uma política mais específica (com plano) sempre vence sobre uma geral."
          value={planoId}
          onChange={(e) => setPlanoId(e.target.value)}
          options={[
            { value: '', label: 'Todos os planos' },
            ...(planos ?? []).map((p) => ({ value: String(p.id), label: p.name })),
          ]}
        />
        <Select
          label="Equipe"
          helper="Vazio = vale pra qualquer equipe."
          value={equipeId}
          onChange={(e) => setEquipeId(e.target.value)}
          options={[
            { value: '', label: 'Todas as equipes' },
            ...(equipes ?? []).map((e) => ({ value: String(e.id), label: e.name })),
          ]}
        />

        <TextInput
          label="Prazo de 1ª resposta (minutos)"
          type="number"
          min={1}
          value={primeiraResposta}
          onChange={(e) => setPrimeiraResposta(e.target.value)}
        />
        <TextInput
          label="Prazo de resolução (minutos)"
          type="number"
          min={1}
          error={
            Number(resolucao) > 0 && Number(primeiraResposta) > 0 && Number(resolucao) < Number(primeiraResposta)
              ? 'Não pode ser menor que o prazo de 1ª resposta.'
              : undefined
          }
          value={resolucao}
          onChange={(e) => setResolucao(e.target.value)}
        />

        <Field>
          <Checkbox
            label="Contar só horário comercial"
            description="Desligado, os prazos correm 24h por dia, inclusive fim de semana."
            checked={horarioComercial}
            onChange={(e) => setHorarioComercial(e.target.checked)}
          />
        </Field>

        {erro && <p className="cfg-erro-form">{erro}</p>}
      </FormRow>
    </Modal>
  )
}
