import { useState } from 'react'
import { Button, Checkbox, Combobox, FormRow, Modal, Select, TextArea, TextInput, useToast } from '@/cvz/components'
import type { Equipe } from '@/api/chat'
import { ApiError } from '@/api/client'
import type { Empresa, Plano } from '@/cvz/clientes/dados'
import {
  ROTULO_AUDIENCIA,
  ROTULO_PAPEL,
  ROTULO_TIPO,
  useAtualizarAviso,
  useCriarAviso,
  type Aviso,
  type TipoAudiencia,
  type TipoAviso,
} from './dados'

const TIPOS: TipoAviso[] = ['info', 'urgent', 'holiday', 'vacation']
const AUDIENCIAS: TipoAudiencia[] = ['all', 'all_internal', 'all_clients', 'teams', 'roles', 'companies', 'plans']
const PAPEIS = ['admin', 'supervisor', 'agent', 'light_agent']

/** `datetime-local` trabalha em "YYYY-MM-DDTHH:mm" local, sem fuso — o que
 *  chega da API é ISO com fuso (`...Z`). Ida e volta é só cortar/completar. */
function paraCampoLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Props {
  open: boolean
  onClose: () => void
  aviso: Aviso | null // null = criar
  equipes: Equipe[]
  empresas: Empresa[]
  planos: Plano[]
}

export function ModalAviso({ open, onClose, aviso, equipes, empresas, planos }: Props) {
  const editando = aviso != null
  const criar = useCriarAviso()
  const atualizar = useAtualizarAviso(aviso?.id ?? 0)
  const { push } = useToast()
  const salvando = criar.isPending || atualizar.isPending

  // Inicializadores preguiçosos, não efeito: `PaginaAvisos` só monta este
  // modal enquanto `editando !== undefined` — cada abertura (criar, ou editar
  // um aviso diferente) já é uma montagem nova, então o estado inicial lido
  // de `aviso` uma vez no useState é suficiente, sem precisar resincronizar.
  const [titulo, setTitulo] = useState(aviso?.title ?? '')
  const [corpo, setCorpo] = useState(aviso?.body ?? '')
  const [tipo, setTipo] = useState<TipoAviso>(aviso?.kind ?? 'info')
  const [inicio, setInicio] = useState(() => paraCampoLocal(aviso?.starts_at ?? new Date().toISOString()))
  const [fim, setFim] = useState(() => paraCampoLocal(aviso?.ends_at ?? null))
  const [fixado, setFixado] = useState(aviso?.is_pinned ?? false)
  const [audiencia, setAudiencia] = useState<TipoAudiencia>(aviso?.audience_kind ?? 'all_internal')
  const [alvoEquipes, setAlvoEquipes] = useState<string[]>(() => (aviso?.target_teams ?? []).map(String))
  const [alvoPapeis, setAlvoPapeis] = useState<string[]>(aviso?.target_roles ?? [])
  const [alvoEmpresas, setAlvoEmpresas] = useState<string[]>(() => (aviso?.target_companies ?? []).map(String))
  const [alvoPlanos, setAlvoPlanos] = useState<string[]>(() => (aviso?.target_plans ?? []).map(String))
  const [erro, setErro] = useState<string | null>(null)

  async function enviar() {
    setErro(null)
    if (!titulo.trim() || !corpo.trim() || !inicio) {
      setErro('Título, texto e início da vigência são obrigatórios.')
      return
    }
    const dados = {
      title: titulo.trim(),
      body: corpo.trim(),
      kind: tipo,
      starts_at: new Date(inicio).toISOString(),
      ends_at: fim ? new Date(fim).toISOString() : null,
      is_pinned: fixado,
      audience_kind: audiencia,
      target_teams: audiencia === 'teams' ? alvoEquipes.map(Number) : [],
      target_roles: audiencia === 'roles' ? alvoPapeis : [],
      target_companies: audiencia === 'companies' ? alvoEmpresas.map(Number) : [],
      target_plans: audiencia === 'plans' ? alvoPlanos.map(Number) : [],
    }
    try {
      if (editando) await atualizar.mutateAsync(dados)
      else await criar.mutateAsync(dados)
      push({ tone: 'success', title: editando ? 'Aviso atualizado' : 'Aviso publicado' })
      onClose()
    } catch (e) {
      setErro(
        e instanceof ApiError
          ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0] ?? 'Não foi possível salvar o aviso.')
          : 'Não foi possível salvar o aviso.',
      )
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editando ? 'Editar aviso' : 'Novo aviso'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={salvando}>
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Publicar aviso'}
          </Button>
        </>
      }
    >
      <FormRow columns={1}>
        <TextInput label="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} autoFocus />
        <TextArea label="Texto" value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={4} />
        <Select
          label="Tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoAviso)}
          options={TIPOS.map((t) => ({ value: t, label: ROTULO_TIPO[t] }))}
        />
      </FormRow>
      <FormRow columns={2}>
        <TextInput
          label="Início da vigência"
          type="datetime-local"
          value={inicio}
          onChange={(e) => setInicio(e.target.value)}
        />
        <TextInput
          label="Fim da vigência"
          helper="Vazio = sem data para acabar"
          type="datetime-local"
          value={fim}
          onChange={(e) => setFim(e.target.value)}
        />
      </FormRow>
      <Checkbox
        label="Fixar no topo do mural"
        checked={fixado}
        onChange={(e) => setFixado(e.target.checked)}
      />
      <FormRow columns={1}>
        <Select
          label="Quem vê este aviso"
          value={audiencia}
          onChange={(e) => setAudiencia(e.target.value as TipoAudiencia)}
          options={AUDIENCIAS.map((a) => ({ value: a, label: ROTULO_AUDIENCIA[a] }))}
        />
        {audiencia === 'teams' && (
          <Combobox
            label="Equipes"
            multiple
            value={alvoEquipes}
            onChange={setAlvoEquipes}
            options={equipes.map((e) => ({ value: String(e.id), label: e.name }))}
            emptyLabel="Nenhuma equipe encontrada"
          />
        )}
        {audiencia === 'roles' && (
          <Combobox
            label="Papéis"
            multiple
            value={alvoPapeis}
            onChange={setAlvoPapeis}
            options={PAPEIS.map((p) => ({ value: p, label: ROTULO_PAPEL[p] }))}
          />
        )}
        {audiencia === 'companies' && (
          <Combobox
            label="Empresas"
            multiple
            value={alvoEmpresas}
            onChange={setAlvoEmpresas}
            options={empresas.map((e) => ({ value: String(e.id), label: e.name }))}
            emptyLabel="Nenhuma empresa encontrada"
          />
        )}
        {audiencia === 'plans' && (
          <Combobox
            label="Planos"
            multiple
            value={alvoPlanos}
            onChange={setAlvoPlanos}
            options={planos.map((p) => ({ value: String(p.id), label: p.name }))}
            emptyLabel="Nenhum plano encontrado"
          />
        )}
      </FormRow>
      {erro && <p className="avisos-erro-meta">{erro}</p>}
    </Modal>
  )
}
