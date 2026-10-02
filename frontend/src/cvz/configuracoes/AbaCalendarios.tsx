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
  Tag,
  TextInput,
  type Column,
} from '@/cvz/components'
import { IconPlus, IconSettings, IconTrash } from '@/cvz/components/icons'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import {
  useAtualizarCalendarioCfg,
  useCalendariosCfg,
  useCriarCalendarioCfg,
  useCriarFeriado,
  useExcluirCalendarioCfg,
  useExcluirFeriado,
  type CalendarioExpediente,
  type Feriado,
  type JanelaExpediente,
} from './dados'

// 0=segunda .. 6=domingo — convenção confirmada em `apps/core/views.py`
// (`day.weekday()`, Python) e no seed (`WORKDAYS` cobre 0..4, seg-sex).
const DIAS_SEMANA = [
  { value: '0', label: 'Segunda' },
  { value: '1', label: 'Terça' },
  { value: '2', label: 'Quarta' },
  { value: '3', label: 'Quinta' },
  { value: '4', label: 'Sexta' },
  { value: '5', label: 'Sábado' },
  { value: '6', label: 'Domingo' },
]
const ROTULO_DIA = new Map(DIAS_SEMANA.map((d) => [Number(d.value), d.label]))

function resumoJanelas(janelas: JanelaExpediente[]): string {
  if (janelas.length === 0) return 'Nenhuma janela'
  const dias = [...new Set(janelas.map((j) => j.weekday))].sort((a, b) => a - b)
  const rotulo = dias.map((d) => ROTULO_DIA.get(d)?.slice(0, 3) ?? '?').join(', ')
  // Mais janelas que dias cobertos = pelo menos um dia com expediente
  // partido (ex.: 09-12 e 13-18) — o número deixa isso visível na lista.
  return janelas.length > dias.length ? `${rotulo} (${janelas.length} janelas)` : rotulo
}

function formatarData(iso: string): string {
  // "T00:00:00" fixa a leitura no fuso local — sem isso, "YYYY-MM-DD" puro
  // é lido como meia-noite UTC e pode exibir o dia anterior no Brasil.
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR')
}

export function AbaCalendarios() {
  const { data: itens, isLoading, isError, error, refetch } = useCalendariosCfg()
  const excluir = useExcluirCalendarioCfg()
  const { push } = useToast()

  const [modalAberto, setModalAberto] = useState(false)
  // Guarda só o id, não o objeto: o modal fica aberto enquanto o formulário
  // de feriados adiciona/remove (`useCriarFeriado`/`useExcluirFeriado`)
  // invalida `cfg-calendarios` por baixo — um snapshot congelado do
  // calendário mostraria a lista de feriados desatualizada até fechar e
  // reabrir. Buscando pelo id em `itens` a cada render, o modal sempre vê
  // a versão mais recente sem precisar de um efeito de ressincronização.
  const [emEdicaoId, setEmEdicaoId] = useState<number | null>(null)
  const emEdicao = itens?.find((c) => c.id === emEdicaoId) ?? null
  const [paraExcluir, setParaExcluir] = useState<CalendarioExpediente | null>(null)

  function abrirEdicao(item: CalendarioExpediente) {
    setEmEdicaoId(item.id)
    setModalAberto(true)
  }

  function abrirCriacao() {
    setEmEdicaoId(null)
    setModalAberto(true)
  }

  const colunas: Column<CalendarioExpediente>[] = [
    {
      key: 'name',
      header: 'Nome',
      mobile: 'title',
      render: (c) => (
        <>
          {c.name} {c.is_default && <Tag tone="blue">Padrão</Tag>}
        </>
      ),
    },
    { key: 'timezone', header: 'Fuso horário', mobile: 'meta', render: (c) => c.timezone },
    { key: 'workdays', header: 'Expediente', mobile: 'meta', render: (c) => resumoJanelas(c.workdays) },
    {
      key: 'holidays',
      header: 'Feriados',
      numeric: true,
      mobile: 'meta',
      sortBy: (c) => c.holidays.length,
      render: (c) => c.holidays.length,
    },
    {
      key: 'editar',
      header: '',
      mobile: 'hidden',
      render: (c) => <IconButton Icon={IconSettings} label={`Editar ${c.name}`} size="sm" bare onClick={() => abrirEdicao(c)} />,
    },
    {
      key: 'excluir',
      header: '',
      mobile: 'hidden',
      render: (c) => (
        <IconButton
          Icon={IconTrash}
          label={`Excluir ${c.name}`}
          size="sm"
          bare
          onClick={(e) => {
            e.stopPropagation()
            setParaExcluir(c)
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
          Novo calendário
        </Button>
      </div>

      <DataTable
        rows={itens ?? []}
        columns={colunas}
        rowKey={(c) => String(c.id)}
        onRowClick={abrirEdicao}
        loading={isLoading}
        empty="Nenhum calendário cadastrado."
      />

      <ModalCalendario
        open={modalAberto}
        calendario={emEdicao}
        onClose={() => setModalAberto(false)}
        onSalvo={(criado) => push({ tone: 'success', title: criado ? 'Calendário criado' : 'Calendário atualizado' })}
      />

      <ConfirmDialog
        open={!!paraExcluir}
        onClose={() => setParaExcluir(null)}
        onConfirm={async () => {
          if (!paraExcluir) return
          try {
            await excluir.mutateAsync(paraExcluir.id)
            push({ tone: 'success', title: 'Calendário excluído' })
          } catch (e) {
            push({
              tone: 'danger',
              title: 'Não foi possível excluir',
              description: e instanceof ApiError ? e.detail : undefined,
            })
          }
        }}
        title={`Excluir "${paraExcluir?.name}"?`}
        description="Empresas e equipes que usam este calendário passam a ficar sem calendário. O SLA não quebra, só perde essa referência. Não dá pra desfazer."
        confirmLabel="Excluir"
        danger
      />
    </div>
  )
}

interface FormularioCalendario {
  name: string
  timezone: string
  is_default: boolean
  workdays: JanelaExpediente[]
}

function formularioDe(c: CalendarioExpediente | null): FormularioCalendario {
  if (!c) {
    return { name: '', timezone: 'America/Sao_Paulo', is_default: false, workdays: [] }
  }
  return { name: c.name, timezone: c.timezone, is_default: c.is_default, workdays: c.workdays }
}

function ModalCalendario({
  open,
  calendario,
  onClose,
  onSalvo,
}: {
  open: boolean
  calendario: CalendarioExpediente | null
  onClose: () => void
  onSalvo: (criado: boolean) => void
}) {
  const criar = useCriarCalendarioCfg()
  const atualizar = useAtualizarCalendarioCfg(calendario?.id ?? 0)

  const [form, setForm] = useState(() => formularioDe(calendario))
  const [erro, setErro] = useState<string | null>(null)
  const [calendarioSemeado, setCalendarioSemeado] = useState(calendario?.id ?? null)
  if (open && (calendario?.id ?? null) !== calendarioSemeado) {
    setCalendarioSemeado(calendario?.id ?? null)
    setForm(formularioDe(calendario))
    setErro(null)
  }

  function campo<K extends keyof FormularioCalendario>(chave: K, valor: FormularioCalendario[K]) {
    setForm((f) => ({ ...f, [chave]: valor }))
  }

  function adicionarJanela() {
    setForm((f) => ({ ...f, workdays: [...f.workdays, { weekday: 0, start: '09:00', end: '18:00' }] }))
  }
  function atualizarJanela(indice: number, patch: Partial<JanelaExpediente>) {
    setForm((f) => ({
      ...f,
      workdays: f.workdays.map((j, i) => (i === indice ? { ...j, ...patch } : j)),
    }))
  }
  function removerJanela(indice: number) {
    setForm((f) => ({ ...f, workdays: f.workdays.filter((_, i) => i !== indice) }))
  }

  async function salvar() {
    setErro(null)
    if (!form.name.trim()) {
      setErro('Nome é obrigatório.')
      return
    }
    try {
      if (calendario) {
        await atualizar.mutateAsync(form)
      } else {
        await criar.mutateAsync(form)
      }
      onSalvo(!calendario)
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
      title={calendario ? `Editar ${calendario.name}` : 'Novo calendário'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pendente}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pendente}>
            {pendente ? 'Salvando…' : calendario ? 'Salvar' : 'Criar calendário'}
          </Button>
        </>
      }
    >
      <FormRow columns={1}>
        <FormRow columns={2}>
          <TextInput label="Nome" value={form.name} onChange={(e) => campo('name', e.target.value)} autoFocus />
          <TextInput
            label="Fuso horário"
            helper="Identificador IANA, ex.: America/Sao_Paulo."
            value={form.timezone}
            onChange={(e) => campo('timezone', e.target.value)}
          />
        </FormRow>

        <Checkbox
          label="Calendário padrão"
          description="Usado quando a empresa cliente (ou a equipe, no chat) não define um calendário próprio. Só um por vez faz sentido, mas marcar aqui não desmarca outro automaticamente."
          checked={form.is_default}
          onChange={(e) => campo('is_default', e.target.checked)}
        />

        <div className="cfg-calendario__secao">
          <div className="cfg-calendario__secao-cabecalho">
            <span className="cfg-permissoes__titulo">Janelas de expediente</span>
            <Button variant="ghost" size="sm" Icon={IconPlus} onClick={adicionarJanela}>
              Adicionar janela
            </Button>
          </div>

          {form.workdays.length === 0 && (
            <p className="cfg-meta-form">Nenhuma janela: este calendário nunca conta como expediente.</p>
          )}

          {form.workdays.map((janela, i) => (
            <div className="cfg-calendario__janela" key={i}>
              <Select
                label="Dia"
                value={String(janela.weekday)}
                onChange={(e) => atualizarJanela(i, { weekday: Number(e.target.value) })}
                options={DIAS_SEMANA}
              />
              <TextInput
                label="Início"
                type="time"
                value={janela.start}
                onChange={(e) => atualizarJanela(i, { start: e.target.value })}
              />
              <TextInput
                label="Fim"
                type="time"
                value={janela.end}
                onChange={(e) => atualizarJanela(i, { end: e.target.value })}
              />
              <IconButton Icon={IconTrash} label={`Remover janela ${i + 1}`} size="sm" bare onClick={() => removerJanela(i)} />
            </div>
          ))}
        </div>

        {calendario && (
          <div className="cfg-calendario__secao">
            <span className="cfg-permissoes__titulo">Feriados</span>
            <SecaoFeriados calendario={calendario} />
          </div>
        )}

        {erro && <p className="cfg-erro-form">{erro}</p>}
      </FormRow>
    </Modal>
  )
}

function SecaoFeriados({ calendario }: { calendario: CalendarioExpediente }) {
  const criar = useCriarFeriado()
  const excluir = useExcluirFeriado()
  const { push } = useToast()

  const [data, setData] = useState('')
  const [nome, setNome] = useState('')
  const [meioPeriodo, setMeioPeriodo] = useState(false)
  const [inicio, setInicio] = useState('12:00')
  const [fim, setFim] = useState('18:00')

  const feriados = useMemo(
    () => [...calendario.holidays].sort((a, b) => a.date.localeCompare(b.date)),
    [calendario.holidays],
  )

  async function adicionar() {
    if (!data || !nome.trim()) return
    try {
      await criar.mutateAsync({
        calendar: calendario.id,
        date: data,
        name: nome.trim(),
        ...(meioPeriodo ? { start_time: inicio, end_time: fim } : {}),
      })
      setData('')
      setNome('')
      setMeioPeriodo(false)
      push({ tone: 'success', title: 'Feriado adicionado' })
    } catch (e) {
      push({
        tone: 'danger',
        title: 'Não foi possível adicionar',
        description: e instanceof ApiError ? e.detail : undefined,
      })
    }
  }

  async function excluirFeriado(f: Feriado) {
    try {
      await excluir.mutateAsync(f.id)
      push({ tone: 'success', title: 'Feriado excluído' })
    } catch (e) {
      push({
        tone: 'danger',
        title: 'Não foi possível excluir',
        description: e instanceof ApiError ? e.detail : undefined,
      })
    }
  }

  return (
    <div className="cfg-calendario__feriados">
      {feriados.length === 0 && <p className="cfg-meta-form">Nenhum feriado cadastrado.</p>}

      {feriados.map((f) => (
        <div className="cfg-calendario__feriado-linha" key={f.id}>
          <span>{formatarData(f.date)}</span>
          <span>{f.name}</span>
          <span>{f.start_time && f.end_time ? `${f.start_time.slice(0, 5)}–${f.end_time.slice(0, 5)}` : 'Dia todo'}</span>
          <IconButton
            Icon={IconTrash}
            label={`Excluir feriado ${f.name}`}
            size="sm"
            bare
            onClick={() => excluirFeriado(f)}
          />
        </div>
      ))}

      <div className="cfg-calendario__feriado-novo">
        <TextInput label="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <TextInput label="Nome" placeholder="Ex.: Natal" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Checkbox
          label="Meio período"
          description="Em vez de fechar o dia todo, abre só nesta janela."
          checked={meioPeriodo}
          onChange={(e) => setMeioPeriodo(e.target.checked)}
        />
        {meioPeriodo && (
          <FormRow columns={2}>
            <TextInput label="Abre às" type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            <TextInput label="Fecha às" type="time" value={fim} onChange={(e) => setFim(e.target.value)} />
          </FormRow>
        )}
        <Button size="sm" Icon={IconPlus} onClick={adicionar} disabled={criar.isPending || !data || !nome.trim()}>
          Adicionar feriado
        </Button>
      </div>
    </div>
  )
}
