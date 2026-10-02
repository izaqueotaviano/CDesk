import { useState } from 'react'
// O Modal do cvz dá o que um diálogo precisa (foco preso, Esc, rolagem
// travada, folha de baixo no celular) — mesma decisão registrada em
// resolv/kanban/ModalFecharTicket.tsx. A pintura vem de lista.scss.
import { Modal } from '@/cvz/components'
import { ApiError } from '@/api/client'
import { useGerenciarVisoes } from './dados'
import type { VisaoPessoal } from './tipos'

interface Props {
  /** Recorte da tela agora (`recorteParaJson`) — o que vai ser guardado. */
  recorte: Record<string, string>
  /** Visão pessoal aberta e alterada: oferece atualizá-la em vez de criar. */
  visaoAtiva: VisaoPessoal | null
  onFechar: () => void
  onSalva: (v: VisaoPessoal) => void
}

function motivoDoErro(e: unknown): string {
  if (e instanceof ApiError) {
    const campo = e.fieldErrors?.name?.[0] ?? e.fieldErrors?.filters?.[0]
    return campo ?? e.detail ?? 'Não foi possível salvar a visão.'
  }
  return 'Não foi possível salvar a visão.'
}

export function ModalSalvarVisao({ recorte, visaoAtiva, onFechar, onSalva }: Props) {
  const { criar, atualizar } = useGerenciarVisoes()
  const [modo, setModo] = useState<'atualizar' | 'nova'>(visaoAtiva ? 'atualizar' : 'nova')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const enviando = criar.isPending || atualizar.isPending
  const precisaNome = modo === 'nova'

  async function salvar() {
    setErro(null)
    try {
      if (modo === 'atualizar' && visaoAtiva) {
        onSalva(await atualizar.mutateAsync({ id: visaoAtiva.id, filters: recorte }))
      } else {
        if (!nome.trim()) {
          setErro('Dê um nome à visão.')
          return
        }
        onSalva(await criar.mutateAsync({ name: nome.trim(), filters: recorte }))
      }
    } catch (e) {
      setErro(motivoDoErro(e))
    }
  }

  return (
    <Modal
      open
      onClose={onFechar}
      title="Salvar visão"
      size="sm"
      footer={
        <>
          <button
            type="button"
            className="lista-tickets__botao lista-tickets__botao--fantasma"
            onClick={onFechar}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="form-salvar-visao"
            className="lista-tickets__botao lista-tickets__botao--primario"
            disabled={enviando}
          >
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form
        id="form-salvar-visao"
        className="lista-form"
        onSubmit={(e) => {
          e.preventDefault()
          void salvar()
        }}
      >
        <p className="lista-form__intro">
          Guarda a visualização, a busca, a ordem e os filtros de agora. Só você vê as suas visões.
        </p>

        {visaoAtiva && (
          <fieldset className="lista-form__opcoes">
            <legend className="lista-tickets__sr">O que salvar</legend>
            <label>
              <input
                type="radio"
                name="modo-visao"
                checked={modo === 'atualizar'}
                onChange={() => setModo('atualizar')}
              />
              Atualizar “{visaoAtiva.name}”
            </label>
            <label>
              <input
                type="radio"
                name="modo-visao"
                checked={modo === 'nova'}
                onChange={() => setModo('nova')}
              />
              Salvar como nova visão
            </label>
          </fieldset>
        )}

        {precisaNome && (
          <label className="lista-form__campo">
            <span>Nome</span>
            <input
              type="text"
              value={nome}
              maxLength={60}
              placeholder="Ex.: Acme, urgentes"
              autoFocus
              aria-invalid={Boolean(erro) || undefined}
              onChange={(e) => setNome(e.target.value)}
            />
          </label>
        )}

        {erro && (
          <p className="lista-form__erro" role="alert">
            {erro}
          </p>
        )}
      </form>
    </Modal>
  )
}
