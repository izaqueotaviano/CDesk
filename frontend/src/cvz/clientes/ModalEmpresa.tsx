import { useState } from 'react'
import { Button, FormRow, Modal, Select, TextInput, useToast } from '@/cvz/components'
import { ApiError } from '@/api/client'
import { slugificar } from '@/cvz/lib/slug'
import { useAtualizarEmpresa, useCriarEmpresa, usePlanos, type Empresa } from './dados'
import './clientes.scss'

/**
 * Cadastro de empresa — criação e edição no MESMO formulário.
 *
 * Um formulário só, e não um "ModalNovaEmpresa" mais um "ModalEditarEmpresa":
 * os campos, a validação e as mensagens são idênticos nos dois casos, e a
 * cópia divergiria na primeira regra nova (foi o que fez o telefone do convite
 * existir no servidor e não na tela).
 *
 * `empresa` ausente/nula = criação. A edição aqui é a rápida (identificação e
 * plano), acessível da lista; o resto do cadastro — limites, domínios,
 * anotações — continua na página de detalhe, que é onde ele cabe.
 */
export function ModalEmpresa({
  empresa,
  open,
  onClose,
  onCriada,
}: {
  empresa?: Empresa | null
  open: boolean
  onClose: () => void
  /** Só faz sentido na criação — a lista usa para ir direto ao detalhe. */
  onCriada?: (id: number) => void
}) {
  const { data: planos } = usePlanos()
  const criar = useCriarEmpresa()
  // Hook sempre chamado (regra dos hooks); em criação não há id e a mutação
  // nunca dispara — quem decide é `enviar()`, logo abaixo.
  const atualizar = useAtualizarEmpresa(empresa?.id ?? 0)
  const { push } = useToast()

  const [nome, setNome] = useState('')
  const [razaoSocial, setRazaoSocial] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)
  const [planoId, setPlanoId] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  // Semeia os campos quando o modal abre (e quando troca de empresa), durante
  // a renderização e não num efeito: assim o formulário já aparece preenchido
  // no primeiro quadro, sem o piscar de campo vazio. Mesmo padrão do detalhe
  // da empresa.
  const chave = open ? String(empresa?.id ?? 'nova') : null
  const [semeadoDe, setSemeadoDe] = useState<string | null>(null)
  if (chave !== semeadoDe) {
    setSemeadoDe(chave)
    setNome(empresa?.name ?? '')
    setRazaoSocial(empresa?.legal_name ?? '')
    setSlug(empresa?.slug ?? '')
    // Numa empresa que já existe o slug NUNCA acompanha o nome: ele está em
    // URLs internas e em vínculos já criados — renomear "Acme" para "Acme
    // Brasil" não pode mudar o endereço dela por baixo.
    setSlugTocado(empresa != null)
    setPlanoId(empresa ? String(empresa.plan) : '')
    setErro(null)
  }

  const editando = empresa != null
  const salvando = editando ? atualizar.isPending : criar.isPending

  function fechar() {
    setSemeadoDe(null)
    onClose()
  }

  async function enviar() {
    setErro(null)
    if (!nome.trim() || !slug.trim() || !planoId) {
      setErro('Nome, identificador e plano são obrigatórios.')
      return
    }
    const dados = {
      name: nome.trim(),
      legal_name: razaoSocial.trim(),
      slug: slug.trim(),
      plan: Number(planoId),
    }
    try {
      if (editando) {
        await atualizar.mutateAsync(dados)
        push({ tone: 'success', title: 'Empresa atualizada', description: dados.name })
      } else {
        const criada = await criar.mutateAsync(dados)
        push({ tone: 'success', title: 'Empresa criada', description: criada.name })
        onCriada?.(criada.id)
      }
      fechar()
    } catch (e) {
      setErro(
        e instanceof ApiError
          ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0])
          : 'Não foi possível salvar a empresa.',
      )
    }
  }

  return (
    <Modal
      open={open}
      onClose={fechar}
      title={editando ? 'Editar empresa' : 'Nova empresa'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={salvando}>
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Criar empresa'}
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
          label="Razão social"
          value={razaoSocial}
          onChange={(e) => setRazaoSocial(e.target.value)}
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
