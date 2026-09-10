import { useState } from 'react'
import { Button, FormRow, Modal, Select, TextInput, useToast } from '@/cvz/components'
import { ApiError } from '@/api/client'
import { slugificar } from '@/cvz/lib/slug'
import { useCriarEmpresa, usePlanos } from './dados'
import './clientes.scss'

export function ModalNovaEmpresa({
  open,
  onClose,
  onCriada,
}: {
  open: boolean
  onClose: () => void
  onCriada: (id: number) => void
}) {
  const { data: planos } = usePlanos()
  const criar = useCriarEmpresa()
  const { push } = useToast()

  const [nome, setNome] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)
  const [planoId, setPlanoId] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function fechar() {
    setNome('')
    setSlug('')
    setSlugTocado(false)
    setPlanoId('')
    setErro(null)
    onClose()
  }

  async function enviar() {
    setErro(null)
    if (!nome.trim() || !slug.trim() || !planoId) {
      setErro('Nome, identificador e plano são obrigatórios.')
      return
    }
    try {
      const empresa = await criar.mutateAsync({ name: nome.trim(), slug: slug.trim(), plan: Number(planoId) })
      push({ tone: 'success', title: 'Empresa criada', description: empresa.name })
      onCriada(empresa.id)
      fechar()
    } catch (e) {
      setErro(e instanceof ApiError ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0]) : 'Não foi possível criar a empresa.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Nova empresa"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={fechar} disabled={criar.isPending}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={criar.isPending}>
            {criar.isPending ? 'Criando…' : 'Criar empresa'}
          </Button>
        </>
      }
    >
      <FormRow columns={1}>
        <TextInput
          label="Nome"
          value={nome}
          onChange={(e) => {
            setNome(e.target.value)
            if (!slugTocado) setSlug(slugificar(e.target.value))
          }}
          autoFocus
        />
        <TextInput
          label="Identificador (slug)"
          helper="Usado em URLs internas — só letras minúsculas, números e hífen."
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value)
            setSlugTocado(true)
          }}
        />
        <Select
          label="Plano"
          value={planoId}
          onChange={(e) => setPlanoId(e.target.value)}
          options={[
            { value: '', label: planos ? 'Selecione…' : 'Carregando…' },
            ...(planos ?? []).map((p) => ({ value: String(p.id), label: p.name })),
          ]}
        />
        {erro && <p className="clientes-erro-meta">{erro}</p>}
      </FormRow>
    </Modal>
  )
}
