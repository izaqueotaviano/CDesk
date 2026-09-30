import { Fragment, useMemo, type ReactNode } from 'react'
import { analisarTexto, type NoInline } from './textoFormatado'
import './texto-formatado.css'

/** Uma menção já resolvida pelo servidor (`MentionSerializer`): `key` é o
 *  miolo da marcação que está no corpo (`user:12`). */
export interface MencaoResolvida {
  key: string
  name: string
  is_active?: boolean
}

interface Props {
  texto: string
  /** Menções que o servidor resolveu para ESTA mensagem. Sem a lista (resposta
   *  pública, portal), `@[user:12]` aparece como texto — que é exatamente o
   *  que o servidor promete para marcação sem menção gravada. */
  mencoes?: MencaoResolvida[]
  className?: string
}

function renderizarNos(nos: NoInline[], mencoes: Map<string, MencaoResolvida> | null): ReactNode[] {
  return nos.map((no, i) => {
    switch (no.tipo) {
      case 'texto':
        return <Fragment key={i}>{no.texto}</Fragment>
      case 'negrito':
        return <strong key={i}>{renderizarNos(no.filhos, mencoes)}</strong>
      case 'italico':
        return <em key={i}>{renderizarNos(no.filhos, mencoes)}</em>
      case 'link':
        return (
          // noopener/noreferrer: a página de destino não ganha `window.opener`
          // nem descobre de que chamado a pessoa veio.
          <a key={i} href={no.href} target="_blank" rel="noopener noreferrer">
            {renderizarNos(no.filhos, mencoes)}
          </a>
        )
      case 'mencao': {
        const alvo = mencoes?.get(no.chave)
        // Sem par no servidor (id forjado, resposta pública): texto literal.
        if (!alvo) return <Fragment key={i}>{no.bruto}</Fragment>
        const inativa = alvo.is_active === false
        return (
          <span
            key={i}
            className={'texto-formatado__mencao' + (inativa ? ' texto-formatado__mencao--inativa' : '')}
            title={inativa ? `${alvo.name} (desativado)` : undefined}
          >
            @{alvo.name}
          </span>
        )
      }
    }
  })
}

/**
 * O corpo de uma mensagem com a formatação leve aplicada (ver
 * `textoFormatado.ts` para o que conta como formatação). Mesma peça no console
 * do agente e no portal do cliente: o texto é o mesmo, então o desenho também.
 *
 * Não usa `dangerouslySetInnerHTML` em lugar nenhum — o texto vira nó de texto,
 * e o único atributo vindo do conteúdo (o `href`) já foi conferido.
 */
export function TextoFormatado({ texto, mencoes, className }: Props) {
  const blocos = useMemo(() => analisarTexto(texto, { mencoes: Boolean(mencoes) }), [texto, mencoes])
  const porChave = useMemo(
    () => (mencoes ? new Map(mencoes.map((m) => [m.key, m])) : null),
    [mencoes],
  )

  return (
    <div className={'texto-formatado' + (className ? ` ${className}` : '')}>
      {blocos.map((bloco, i) => {
        if (bloco.tipo === 'paragrafo') {
          return (
            <p key={i}>
              {bloco.linhas.map((linha, j) => (
                <Fragment key={j}>
                  {j > 0 && '\n'}
                  {renderizarNos(linha, porChave)}
                </Fragment>
              ))}
            </p>
          )
        }
        const itens = bloco.itens.map((item, j) => <li key={j}>{renderizarNos(item, porChave)}</li>)
        return bloco.ordenada ? (
          <ol key={i} start={bloco.inicio !== 1 ? bloco.inicio : undefined}>
            {itens}
          </ol>
        ) : (
          <ul key={i}>{itens}</ul>
        )
      })}
    </div>
  )
}
