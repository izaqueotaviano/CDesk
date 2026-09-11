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
  /** O texto digitado, a cada tecla — quem chama decide o que fazer com ele
   *  (aqui, PaginaNovoTicket.tsx debounca e manda pro servidor: a busca de
   *  verdade não é mais em memória sobre `opcoes`, que agora chega PRONTA de
   *  fora). `aoDigitar` já filtra `opcoes` internamente por conta própria —
   *  isso continua valendo mesmo com busca no servidor: estreita na hora o
   *  resultado da consulta anterior enquanto a nova ainda não chegou. */
  aoMudarTermo?: (texto: string) => void
  /** A CONSULTA que alimenta `opcoes` falhou (rede, 500) — sem isto o
   *  componente não tem como saber a diferença entre "ninguém com esse nome"
   *  e "não consegui nem perguntar", e mentia a primeira frase pela segunda. */
  erro?: boolean
  /** Some sem `erro`; com `erro`, aparece junto da mensagem de falha. */
  aoTentarDeNovo?: () => void
}

const MAX_RESULTADOS = 8

/** "Joao" acha "João"; "ACME" acha "acme". */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Combobox de pessoa (WAI-ARIA "combobox with list autocomplete"): um campo
 * de texto que filtra por nome, e-mail ou empresa; setas navegam, Enter
 * escolhe, Esc fecha. Escolhido, o campo mostra o nome e ganha um "×" para
 * limpar; digitar de novo volta a ser busca.
 *
 * `opcoes` chega PRONTA de fora — quem chama (PaginaNovoTicket.tsx) busca no
 * servidor (`GET /api/v1/search/`, sem teto de 500 do diretório antigo) e
 * debounca via `aoMudarTermo`; o filtro em memória aqui dentro (`resultados`)
 * é só a última milha, pra estreitar a resposta anterior sem esperar a nova
 * chegar — não é mais a busca inteira.
 */
export const BuscaPessoa = forwardRef<HTMLInputElement, Props>(function BuscaPessoa(
  {
    id,
    opcoes,
    valor,
    onChange,
    placeholder,
    carregando,
    disabled,
    invalido,
    describedBy,
    vazio,
    erro,
    aoTentarDeNovo,
    aoMudarTermo,
  },
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
    aoMudarTermo?.('')
    setAberto(false)
  }

  function limpar() {
    onChange(null)
    setTexto('')
    aoMudarTermo?.('')
    setAberto(true)
  }

  function aoDigitar(v: string) {
    // digitar em cima de alguém escolhido é começar outra busca
    if (escolhido) onChange(null)
    setTexto(v)
    aoMudarTermo?.(v)
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
      // Combobox ARIA: o foco real nunca sai do input (as opções são
      // "virtuais", via `aria-activedescendant`) — então o retry por teclado
      // também precisa disparar daqui, sem exigir Tab até o botão visível
      // (que só o clique do mouse alcança de forma confiável, porque o Tab
      // dispara blur, que fecha a lista antes de o foco chegar lá dentro).
      if (erro && listaVisivel && aoTentarDeNovo) {
        e.preventDefault()
        aoTentarDeNovo()
      } else if (listaVisivel && resultados[ativo]) {
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
          aria-activedescendant={
            listaVisivel && resultados[ativo] ? idOpcao(resultados[ativo]) : undefined
          }
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
        ) : erro ? (
          // Antes disto o `resultados.length === 0` abaixo cobria os dois
          // casos com a MESMA frase — "ninguém com esse nome" é uma afirmação
          // sobre a busca, e uma consulta que nem respondeu não fez busca
          // nenhuma. `onMouseDown` já tem `preventDefault()` no <ul> (evita o
          // blur fechar a lista antes do clique), então o botão usa `onClick`
          // normal, igual às opções da lista.
          <li className="busca-pessoa__vazio busca-pessoa__vazio--erro" role="presentation">
            <i className="ti ti-alert-circle" aria-hidden="true" /> Não foi possível carregar as
            pessoas.
            {aoTentarDeNovo && (
              <button type="button" className="busca-pessoa__retentar" onClick={aoTentarDeNovo}>
                Tentar de novo
              </button>
            )}
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
        {listaVisivel && !carregando
          ? erro
            ? 'Não foi possível carregar as pessoas.'
            : texto.trim()
              ? resultados.length === 0
                ? 'Nenhum resultado'
                : `${resultados.length} resultado${resultados.length === 1 ? '' : 's'}`
              : ''
          : ''}
      </span>
    </div>
  )
})
