import { useState } from 'react'
import { Button, FormRow, Modal, Select, TextInput, useToast } from '@/cvz/components'
import { ApiError } from '@/api/client'
import { useConvidarUsuario, type ClientRole } from './dados'
import './clientes.scss'

export function ModalConvidarUsuario({
  empresaId,
  open,
  onClose,
}: {
  empresaId: number
  open: boolean
  onClose: () => void
}) {
  const convidar = useConvidarUsuario(empresaId)
  const { push } = useToast()

  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<ClientRole>('member')
  const [erro, setErro] = useState<string | null>(null)

  function fechar() {
    setNome('')
    setEmail('')
    setPapel('member')
    setErro(null)
    onClose()
  }

  async function enviar() {
    setErro(null)
    if (!nome.trim() || !email.trim()) {
      setErro('Nome e e-mail são obrigatórios.')
      return
    }
    try {
      await convidar.mutateAsync({ full_name: nome.trim(), email: email.trim(), client_role: papel })
      push({ tone: 'success', title: 'Convite enviado', description: `${nome} vai receber o e-mail de convite.` })
      fechar()
    } catch (e) {
      setErro(
        e instanceof ApiError ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0]) : 'Não foi possível convidar.',
      )
    }
  }

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Convidar usuário"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={fechar} disabled={convidar.isPending}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={convidar.isPending}>
            {convidar.isPending ? 'Enviando…' : 'Enviar convite'}
          </Button>
        </>
      }
    >
      <FormRow columns={1}>
        <TextInput label="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        <TextInput label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Select
          label="Papel"
          value={papel}
          onChange={(e) => setPapel(e.target.value as ClientRole)}
          options={[
            { value: 'member', label: 'Usuário' },
            { value: 'owner', label: 'Responsável' },
          ]}
        />
        {erro && <p className="clientes-erro-meta">{erro}</p>}
      </FormRow>
    </Modal>
  )
}
