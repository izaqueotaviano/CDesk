import { useMemo, useState } from 'react'
import { Button, Combobox, FormRow, Modal, Select, TextInput } from '@/cvz/components'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import { useAgentes } from '@/cvz/tickets/dados'
import { useAdicionarAgenteCfg, useChoicesCfg, type EquipeRosterCfg } from './dados'

function mensagemDeErro(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0] ?? padrao) : padrao
}

/**
 * "+ Adicionar agente" de uma equipe — os dois caminhos que `add_agent`
 * aceita no mesmo corpo (`TeamAdminViewSet.add_agent`): criar alguém do zero
 * já lotado aqui, ou vincular quem já existe noutra equipe (ou sem
 * nenhuma). Um modal só, porque de dentro da equipe é a mesma intenção —
 * "quero mais gente aqui" — só muda se a pessoa já tem cadastro.
 */
export function ModalAdicionarAgente({
  equipe,
  open,
  onClose,
}: {
  equipe: EquipeRosterCfg | null
  open: boolean
  onClose: () => void
}) {
  const adicionar = useAdicionarAgenteCfg(equipe?.id ?? 0)
  const { data: agentes } = useAgentes()
  const { data: choices } = useChoicesCfg()
  const { push } = useToast()

  const [modo, setModo] = useState<'novo' | 'existente'>('novo')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState('agent')
  const [agenteExistente, setAgenteExistente] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // Quem já está nesta equipe não precisa aparecer na busca de "vincular
  // existente" — escolher de novo só recriaria o mesmo vínculo (o backend
  // aceita, é `get_or_create`, mas a lista some da tela sem ganhar nada).
  const idsNaEquipe = useMemo(() => new Set((equipe?.agents ?? []).map((a) => a.id)), [equipe])
  const opcoesExistente = useMemo(
    () =>
      (agentes ?? [])
        .filter((a) => !idsNaEquipe.has(a.id))
        .map((a) => ({ value: String(a.id), label: a.full_name, description: a.email })),
    [agentes, idsNaEquipe],
  )

  function fechar() {
    setModo('novo')
    setNome('')
    setEmail('')
    setPapel('agent')
    setAgenteExistente(null)
    setErro(null)
    onClose()
  }

  async function enviar() {
    setErro(null)
    if (!equipe) return
    try {
      if (modo === 'existente') {
        if (!agenteExistente) {
          setErro('Escolha um agente para vincular.')
          return
        }
        await adicionar.mutateAsync({ user: Number(agenteExistente) })
      } else {
        if (!nome.trim() || !email.trim()) {
          setErro('Nome e e-mail são obrigatórios.')
          return
        }
        await adicionar.mutateAsync({ full_name: nome.trim(), email: email.trim(), internal_role: papel })
      }
      push({ tone: 'success', title: 'Agente adicionado', description: `Agora atende ${equipe.name}.` })
      fechar()
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível adicionar o agente.'))
    }
  }

  return (
    <Modal
      open={open}
      onClose={fechar}
      title={equipe ? `Adicionar agente — ${equipe.name}` : 'Adicionar agente'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={fechar} disabled={adicionar.isPending}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={adicionar.isPending}>
            {adicionar.isPending ? 'Adicionando…' : 'Adicionar'}
          </Button>
        </>
      }
    >
      <FormRow columns={1}>
        <div className="cfg-roster__modo" role="radiogroup" aria-label="Como adicionar">
          <Button
            type="button"
            variant={modo === 'novo' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={modo === 'novo'}
            onClick={() => setModo('novo')}
          >
            Criar novo
          </Button>
          <Button
            type="button"
            variant={modo === 'existente' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={modo === 'existente'}
            onClick={() => setModo('existente')}
          >
            Vincular quem já existe
          </Button>
        </div>

        {modo === 'existente' ? (
          <Combobox
            label="Agente"
            placeholder="Buscar por nome"
            emptyLabel="Nenhum agente disponível para vincular."
            options={opcoesExistente}
            value={agenteExistente}
            onChange={setAgenteExistente}
          />
        ) : (
          <>
            <TextInput label="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
            <TextInput label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Select
              label="Papel"
              value={papel}
              onChange={(e) => setPapel(e.target.value)}
              options={choices?.internal_roles ?? [{ value: 'agent', label: 'Agente' }]}
            />
          </>
        )}

        {erro && <p className="cfg-erro-form">{erro}</p>}
      </FormRow>
    </Modal>
  )
}
