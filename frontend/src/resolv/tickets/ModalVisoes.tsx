import { useState } from 'react'
import { Modal } from '@/cvz/components'
import { ApiError } from '@/api/client'
import { useGerenciarVisoes, useVisoesPessoais } from './dados'
import type { VisaoPessoal } from './tipos'

interface Props {
  onFechar: () => void
  /** Avisa a página quando a visão aberta é apagada (ela volta à padrão). */
  onApagada: (id: number) => void
}

function motivo(e: unknown, padrao: string): string {
  if (e instanceof ApiError) return e.fieldErrors?.name?.[0] ?? e.detail ?? padrao
  return padrao
}

/**
 * "Personalizar visualizações": renomear, reordenar e apagar as visões
 * pessoais. Reordenar é por botões (subir/descer), não arrastar: funciona
 * igual no teclado, no leitor de tela e no dedo, e a lista tem poucas linhas.
 */
export function ModalVisoes({ onFechar, onApagada }: Props) {
  const { data: visoes = [] } = useVisoesPessoais()
  const { atualizar, excluir, reordenar } = useGerenciarVisoes()
  const [editando, setEditando] = useState<number | null>(null)
  const [nome, setNome] = useState('')
  const [apagando, setApagando] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  function comecarEdicao(v: VisaoPessoal) {
    setErro(null)
    setApagando(null)
    setEditando(v.id)
    setNome(v.name)
  }

  async function renomear(v: VisaoPessoal) {
    const novo = nome.trim()
    if (!novo || novo === v.name) {
      setEditando(null)
      return
    }
    try {
      await atualizar.mutateAsync({ id: v.id, name: novo })
      setEditando(null)
      setAviso(`Renomeada para “${novo}”.`)
    } catch (e) {
      setErro(motivo(e, 'Não foi possível renomear.'))
    }
  }

  async function apagar(v: VisaoPessoal) {
    try {
      await excluir.mutateAsync(v.id)
      setApagando(null)
      setAviso(`“${v.name}” apagada.`)
      onApagada(v.id)
    } catch (e) {
      setErro(motivo(e, 'Não foi possível apagar.'))
    }
  }

  function mover(indice: number, direcao: -1 | 1) {
    const ids = visoes.map((v) => v.id)
    const alvo = indice + direcao
    if (alvo < 0 || alvo >= ids.length) return
    ;[ids[indice], ids[alvo]] = [ids[alvo]!, ids[indice]!]
    setErro(null)
    reordenar.mutate(ids, {
      onError: (e) => setErro(motivo(e, 'Não foi possível reordenar.')),
    })
    setAviso(`“${visoes[indice]!.name}” movida para a posição ${alvo + 1}.`)
  }

  return (
    <Modal
      open
      onClose={onFechar}
      title="Personalizar visualizações"
      size="md"
      footer={
        <button
          type="button"
          className="lista-tickets__botao lista-tickets__botao--primario"
          onClick={onFechar}
        >
          Concluir
        </button>
      }
    >
      {visoes.length === 0 ? (
        <p className="lista-form__intro">Você ainda não tem visualizações pessoais.</p>
      ) : (
        <ul className="gerenciar-visoes">
          {visoes.map((v, i) => (
            <li key={v.id} className="gerenciar-visoes__item">
              {editando === v.id ? (
                <form
                  className="gerenciar-visoes__edicao"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void renomear(v)
                  }}
                >
                  <input
                    type="text"
                    aria-label={`Novo nome para ${v.name}`}
                    value={nome}
                    maxLength={60}
                    autoFocus
                    onChange={(e) => setNome(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        setEditando(null)
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="lista-tickets__botao lista-tickets__botao--primario"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    className="lista-tickets__botao lista-tickets__botao--fantasma"
                    onClick={() => setEditando(null)}
                  >
                    Cancelar
                  </button>
                </form>
              ) : apagando === v.id ? (
                <div
                  className="gerenciar-visoes__confirmar"
                  role="group"
                  aria-label={`Apagar ${v.name}`}
                >
                  <span>Apagar “{v.name}”? Os tickets não mudam.</span>
                  <button
                    type="button"
                    className="lista-tickets__botao lista-tickets__botao--perigo"
                    autoFocus
                    onClick={() => void apagar(v)}
                  >
                    Apagar
                  </button>
                  <button
                    type="button"
                    className="lista-tickets__botao lista-tickets__botao--fantasma"
                    onClick={() => setApagando(null)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <>
                  <span className="gerenciar-visoes__nome">{v.name}</span>
                  <div className="gerenciar-visoes__acoes">
                    <button
                      type="button"
                      className="lista-tickets__icone"
                      aria-label={`Subir ${v.name}`}
                      title="Subir"
                      disabled={i === 0}
                      onClick={() => mover(i, -1)}
                    >
                      <i className="ti ti-arrow-up" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="lista-tickets__icone"
                      aria-label={`Descer ${v.name}`}
                      title="Descer"
                      disabled={i === visoes.length - 1}
                      onClick={() => mover(i, 1)}
                    >
                      <i className="ti ti-arrow-down" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="lista-tickets__icone"
                      aria-label={`Renomear ${v.name}`}
                      title="Renomear"
                      onClick={() => comecarEdicao(v)}
                    >
                      <i className="ti ti-pencil" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="lista-tickets__icone lista-tickets__icone--perigo"
                      aria-label={`Apagar ${v.name}`}
                      title="Apagar"
                      onClick={() => {
                        setEditando(null)
                        setApagando(v.id)
                      }}
                    >
                      <i className="ti ti-trash" aria-hidden="true" />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {erro && (
        <p className="lista-form__erro" role="alert">
          {erro}
        </p>
      )}
      {/* Confirmação para leitor de tela: subir/descer não muda o foco, e
          sem isto a mudança de ordem seria silenciosa. */}
      <p className="lista-tickets__sr" role="status">
        {aviso}
      </p>
    </Modal>
  )
}
