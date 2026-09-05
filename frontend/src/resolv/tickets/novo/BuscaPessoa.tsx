import { forwardRef, useId, useMemo, useState, type KeyboardEvent } from 'react'

export interface Pessoa {
  id: number
  nome: string
  /** E-mail, empresa — entra na busca e aparece embaixo do nome. */
  descricao?: string
}

interface Props {
  id: string
  opcoes: Pessoa[]
  valor: number | null
  onChange: (id: number | null) => void
  placeholder?: string
  carregando?: boolean
  disabled?: boolean
  invalido?: boolean
  describedBy?: string
  /** Texto quando a busca não acha ninguém. */
  vazio?: string
}

const MAX_RESULTADOS = 8

/** "Joao" acha "João"; "ACME" acha "acme". */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Combobox de pessoa (WAI-ARIA "combobox with list autocomplete"): um campo
 * de texto que filtra por nome, e-mail ou empresa; setas navegam, Enter
 * escolhe, Esc fecha. Escolhido, o campo mostra o nome e ganha um "×" para
 * limpar; digitar de novo volta a ser busca.
 *
 * A lista é filtrada aqui porque o diretório não tem busca no servidor
 * (UserViewSet só filtra por `kind`/`company`) — quem chama traz a lista
 * inteira e este componente a mantém legível.
 */
export const BuscaPessoa = forwardRef<HTMLInputElement, Props>(function BuscaPessoa(
  { id, opcoes, valor, onChange, placeholder, carregando, disabled, invalido, describedBy, vazio },
  ref,
) {
  const idLista = useId()
  const [texto, setTexto] = useState('')
  const [aberto, setAberto] = useState(false)
  const [ativo, setAtivo] = useState(0)

  const escolhido = valor != null ? (opcoes.find((o) => o.id === valor) ?? null) : null

  const resultados = useMemo(() => {
    const q = normalizar(texto.trim())
    const base = q
      ? opcoes.filter((o) => normalizar(`${o.nome} ${o.descricao ?? ''}`).includes(q))
      : opcoes
    return base.slice(0, MAX_RESULTADOS)
  }, [opcoes, texto])

  const listaVisivel = aberto && !disabled
  const idOpcao = (o: Pessoa) => `${idLista}-${o.id}`

  function escolher(o: Pessoa) {
    onChange(o.id)
    setTexto('')
    setAberto(false)
  }

  function limpar() {
    onChange(null)
    setTexto('')
    setAberto(true)
  }

  function aoDigitar(v: string) {
    // digitar em cima de alguém escolhido é começar outra busca
    if (escolhido) onChange(null)
    setTexto(v)
    setAtivo(0)
    setAberto(true)
  }

  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!aberto) setAberto(true)
      else setAtivo((i) => Math.min(i + 1, resultados.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAtivo((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (listaVisivel && resultados[ativo]) {
        e.preventDefault()
        escolher(resultados[ativo])
      }
    } else if (e.key === 'Escape') {
      if (aberto) {
        e.preventDefault()
        setAberto(false)
      }
    }
  }

  return (
    <div className={'busca-pessoa' + (escolhido ? ' busca-pessoa--escolhido' : '')}>
      <span className="busca-pessoa__campo">
        <i className={escolhido ? 'ti ti-user-check' : 'ti ti-search'} aria-hidden="true" />
        <input
          ref={ref}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={listaVisivel}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={listaVisivel && resultados[ativo] ? idOpcao(resultados[ativo]) : undefined}
          aria-invalid={invalido || undefined}
          aria-describedby={describedBy}
          placeholder={placeholder}
          disabled={disabled}
          value={escolhido ? escolhido.nome : texto}
          onChange={(e) => aoDigitar(e.target.value)}
          onFocus={(e) => {
            // com alguém escolhido, o texto fica selecionado: digitar substitui
            if (escolhido) e.currentTarget.select()
            setAberto(true)
          }}
          onBlur={() => setAberto(false)}
          onKeyDown={aoTeclar}
        />
        {escolhido && !disabled && (
          <button
            type="button"
            className="busca-pessoa__limpar"
            aria-label="Limpar solicitante"
            // mousedown, não click: o click chegaria depois do blur do input
            onMouseDown={(e) => {
              e.preventDefault()
              limpar()
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        )}
      </span>

      <ul
        id={idLista}
        role="listbox"
        className="busca-pessoa__lista"
        hidden={!listaVisivel}
        // manter o foco no input enquanto se clica na lista (senão o blur
        // fecha a lista antes de o click escolher)
        onMouseDown={(e) => e.preventDefault()}
      >
        {carregando ? (
          <li className="busca-pessoa__vazio" role="presentation">
            Carregando pessoas…
          </li>
        ) : resultados.length === 0 ? (
          <li className="busca-pessoa__vazio" role="presentation">
            {vazio ?? 'Ninguém com esse nome ou e-mail.'}
          </li>
        ) : (
          resultados.map((o, i) => (
            <li
              key={o.id}
              id={idOpcao(o)}
              role="option"
              aria-selected={i === ativo}
              className={'busca-pessoa__opcao' + (i === ativo ? ' busca-pessoa__opcao--ativa' : '')}
              onMouseEnter={() => setAtivo(i)}
              onClick={() => escolher(o)}
            >
              <span className="busca-pessoa__nome">{o.nome}</span>
              {o.descricao && <span className="busca-pessoa__desc">{o.descricao}</span>}
            </li>
          ))
        )}
      </ul>

      <span className="busca-pessoa__sr" aria-live="polite">
        {listaVisivel && !carregando && texto.trim()
          ? resultados.length === 0
            ? 'Nenhum resultado'
            : `${resultados.length} resultado${resultados.length === 1 ? '' : 's'}`
          : ''}
      </span>
    </div>
  )
})
