import { useState } from 'react'
import { Button, Field, FormRow, Modal, Select, Tag, TextInput, Toggle, useToast } from '@/cvz/components'
import { ApiError } from '@/api/client'
import { useAtualizarUsuario, type ClientRole, type UsuarioCliente } from './dados'
import './clientes.scss'

function formatarData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : 'Nunca'
}

function rotuloPapel(papel: UsuarioCliente['client_role']): string {
  return papel === 'owner' ? 'Responsável' : 'Usuário'
}

/**
 * Ficha de um usuário de cliente: ver e editar no mesmo lugar.
 *
 * Dois modos e não dois componentes porque é a mesma ficha — quem abre para
 * conferir um telefone descobre ali mesmo o botão de corrigi-lo, em vez de
 * fechar e procurar outro caminho.
 *
 * O que dá para editar é o que `UserAdminSerializer` aceita para um cliente
 * pela rota plana `settings/users/<id>/`. `email` fica de fora (identidade de
 * login) e `company` também: mover alguém de empresa não é edição de cadastro.
 */
export function ModalUsuario({
  empresaId,
  usuario,
  modoInicial,
  podeEditar,
  onClose,
}: {
  empresaId: number
  usuario: UsuarioCliente
  modoInicial: 'ver' | 'editar'
  podeEditar: boolean
  onClose: () => void
}) {
  const atualizar = useAtualizarUsuario(empresaId, usuario.id)
  const { push } = useToast()

  const [modo, setModo] = useState<'ver' | 'editar'>(modoInicial)
  const [nome, setNome] = useState(usuario.full_name)
  const [papel, setPapel] = useState<ClientRole>(usuario.client_role === 'owner' ? 'owner' : 'member')
  const [cargo, setCargo] = useState(usuario.job_title)
  const [telefone, setTelefone] = useState(usuario.phone)
  const [telefoneSecundario, setTelefoneSecundario] = useState(usuario.phone_secondary)
  const [ativo, setAtivo] = useState(usuario.is_active)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    setErro(null)
    if (!nome.trim()) {
      setErro('O nome é obrigatório.')
      return
    }
    // Mesma exigência do servidor no cadastro de cliente: ao menos um dos dois
    // telefones. Vale na edição também — apagar os dois derrubaria a regra.
    if (!telefone.trim() && !telefoneSecundario.trim()) {
      setErro('Informe ao menos um telefone.')
      return
    }
    try {
      await atualizar.mutateAsync({
        full_name: nome.trim(),
        client_role: papel,
        job_title: cargo.trim(),
        phone: telefone.trim(),
        phone_secondary: telefoneSecundario.trim(),
        is_active: ativo,
      })
      push({ tone: 'success', title: 'Usuário atualizado', description: nome.trim() })
      onClose()
    } catch (e) {
      setErro(
        e instanceof ApiError
          ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0])
          : 'Não foi possível salvar.',
      )
    }
  }

  const rodapeVer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        Fechar
      </Button>
      {podeEditar && <Button onClick={() => setModo('editar')}>Editar</Button>}
    </>
  )

  const rodapeEditar = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={atualizar.isPending}>
        Cancelar
      </Button>
      <Button onClick={salvar} disabled={atualizar.isPending}>
        {atualizar.isPending ? 'Salvando…' : 'Salvar alterações'}
      </Button>
    </>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title={modo === 'ver' ? usuario.full_name : `Editar ${usuario.full_name}`}
      size="sm"
      footer={modo === 'ver' ? rodapeVer : rodapeEditar}
    >
      {modo === 'ver' ? (
        <dl className="clientes-ficha">
          <div>
            <dt>E-mail</dt>
            <dd>{usuario.email}</dd>
          </div>
          <div>
            <dt>Papel</dt>
            <dd>{rotuloPapel(usuario.client_role)}</dd>
          </div>
          <div>
            <dt>Cargo</dt>
            <dd>{usuario.job_title || '—'}</dd>
          </div>
          <div>
            <dt>Telefone</dt>
            <dd>{usuario.phone || '—'}</dd>
          </div>
          <div>
            <dt>Telefone secundário</dt>
            <dd>{usuario.phone_secondary || '—'}</dd>
          </div>
          <div>
            <dt>Convite</dt>
            <dd>
              <Tag tone={usuario.invite_status === 'aceito' ? 'success' : 'away'}>
                {usuario.invite_status === 'aceito' ? 'Aceito' : 'Pendente'}
              </Tag>
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <Tag tone={usuario.is_active ? 'success' : 'neutral'} dot>
                {usuario.is_active ? 'Ativo' : 'Inativo'}
              </Tag>
            </dd>
          </div>
          <div>
            <dt>Último acesso</dt>
            <dd>{formatarData(usuario.last_login)}</dd>
          </div>
        </dl>
      ) : (
        <FormRow columns={1}>
          <TextInput label="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
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
          <Field label="Acesso" helper="Inativo perde o acesso agora; o histórico continua preservado.">
            <Toggle label={ativo ? 'Ativo' : 'Inativo'} checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          </Field>
          <p className="clientes-meta">
            O e-mail ({usuario.email}) é a identidade de login e não muda por aqui.
          </p>
          {erro && <p className="clientes-erro-meta">{erro}</p>}
        </FormRow>
      )}
    </Modal>
  )
}
