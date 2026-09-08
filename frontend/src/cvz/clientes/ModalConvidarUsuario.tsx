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
  const [cargo, setCargo] = useState('')
  const [telefone, setTelefone] = useState('')
  const [telefoneSecundario, setTelefoneSecundario] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function fechar() {
    setNome('')
    setEmail('')
    setPapel('member')
    setCargo('')
    setTelefone('')
    setTelefoneSecundario('')
    setErro(null)
    onClose()
  }

  async function enviar() {
    setErro(null)
    if (!nome.trim() || !email.trim()) {
      setErro('Nome e e-mail são obrigatórios.')
      return
    }
    // Mesma regra do servidor (`UserAdminSerializer.validate`): cadastro de
    // cliente exige UM dos dois telefones, e nenhum é obrigatório sozinho.
    // Barrar aqui evita a viagem de rede e, principalmente, o 400 que a
    // pessoa levava sem ter onde digitar o número.
    if (!telefone.trim() && !telefoneSecundario.trim()) {
      setErro('Informe ao menos um telefone.')
      return
    }
    try {
      await convidar.mutateAsync({
        full_name: nome.trim(),
        email: email.trim(),
        client_role: papel,
        job_title: cargo.trim(),
        phone: telefone.trim(),
        phone_secondary: telefoneSecundario.trim(),
      })
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
        <TextInput label="Cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} />
        <TextInput
          label="Telefone"
          type="tel"
          helper="Preencha ao menos um dos dois telefones."
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
        />
        <TextInput
          label="Telefone secundário"
          type="tel"
          value={telefoneSecundario}
          onChange={(e) => setTelefoneSecundario(e.target.value)}
        />
        {erro && <p className="clientes-erro-meta">{erro}</p>}
      </FormRow>
    </Modal>
  )
}
