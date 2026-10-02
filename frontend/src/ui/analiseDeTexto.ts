/**
 * Formatação leve das mensagens: um SUBCONJUNTO pequeno de Markdown, gravado
 * como texto no próprio `body` (sem campo novo, sem HTML no banco).
 *
 * O que é reconhecido — e nada além disso:
 *
 *   **negrito**                  → <strong>
 *   _itálico_  ou  *itálico*     → <em>
 *   - item  /  * item            → lista com marcador (linhas seguidas)
 *   1. item  /  1) item          → lista numerada (1 a 3 dígitos; o primeiro
 *                                  número vira o `start` da lista)
 *   [rótulo](https://…)          → link; só http, https e mailto
 *   https://… solto              → link (o que o e-mail já fazia)
 *   @[user:12] / @[team:3]       → menção (só onde quem chama resolve o nome)
 *
 * Por que um subconjunto e não Markdown inteiro: a mensagem continua sendo
 * TEXTO para quem não formatou nada. Título com `#`, bloco de código, tabela,
 * imagem e HTML cru ficam de fora de propósito — cada um deles transformaria
 * sem querer um texto que o cliente escreveu à mão ("# do pedido", "<3").
 *
 * As regras que protegem o texto antigo:
 *  - o marcador precisa "abraçar" uma palavra: `* 3 *` e `5*3*2` continuam
 *    como estão, `snake_case_nome` não vira itálico;
 *  - quebras de linha continuam sendo quebras de linha (nada de parágrafo
 *    que junta linhas, como no Markdown de verdade);
 *  - o que não fecha (`**sem par`) aparece exatamente como foi escrito;
 *  - link com esquema fora da lista (javascript:, data:, vbscript:…) não vira
 *    link: fica o texto literal, visível para quem lê.
 *
 * Segurança: este módulo nunca produz HTML. Ele devolve uma árvore que o
 * componente `TextoFormatado` transforma em elementos React — o texto chega ao
 * DOM como nó de texto, então `<script>` escrito na mensagem é só texto. O
 * único atributo que vem do conteúdo é o `href`, e ele passa por `hrefSeguro`.
 *
 * O servidor tem o gêmeo desta regra para o e-mail
 * (apps/notifications/formatacao.py) — mudar um é mudar o outro.
 */

export type NoInline =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'negrito'; filhos: NoInline[] }
  | { tipo: 'italico'; filhos: NoInline[] }
  | { tipo: 'link'; href: string; filhos: NoInline[] }
  | { tipo: 'mencao'; chave: string; bruto: string }

export type Bloco =
  | { tipo: 'paragrafo'; linhas: NoInline[][] }
  | { tipo: 'lista'; ordenada: boolean; inicio: number; itens: NoInline[][] }

export interface OpcoesAnalise {
  /** Reconhece `@[user:12]`/`@[team:3]` como menção. Sem isto a marcação
   *  fica como texto — é o caso de resposta pública, onde o servidor nunca
   *  grava menção. */
  mencoes?: boolean
}

const ESQUEMAS_PERMITIDOS = /^(?:https?:\/\/|mailto:)/i

function temControle(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/**
 * O `href` que pode ir para o DOM, ou `null`.
 *
 * Só http, https e mailto. Caractere de controle ou espaço no meio é recusado
 * inteiro: é o truque clássico de `java\tscript:` que alguns navegadores
 * "consertam" antes de interpretar.
 */
export function hrefSeguro(url: string): string | null {
  const limpo = url.trim()
  if (!limpo || /\s/.test(limpo) || temControle(limpo)) return null
  if (!ESQUEMAS_PERMITIDOS.test(limpo)) return null
  if (/^mailto:/i.test(limpo)) return limpo.length > 7 ? limpo : null
  // "https://" sozinho não leva a lugar nenhum
  return /^https?:\/\/[^/?#]+/i.test(limpo) ? limpo : null
}

// A ordem das alternativas é a prioridade quando duas começam no mesmo ponto:
// menção, link com rótulo, link solto, negrito, itálico.
//   1: menção inteira
//   2,3: rótulo e endereço do link
//   4: link solto
//   5: miolo do negrito
//   6,7: marcador e miolo do itálico
const PADRAO_INLINE =
  /(@\[(?:user|team):\d+\])|\[([^\]\n]+)\]\(([^()\s]+)\)|(https?:\/\/[^\s<>]+)|\*\*(?=\S)([^\n]*?\S)\*\*(?!\*)|(?<![\p{L}\p{N}_*])([*_])(?![*_\s])([^\n]*?[^\s*_])\6(?![\p{L}\p{N}_*])/gu

/** Pontuação que termina a frase e não o endereço: "veja https://x.com." */
function aparaFimDeLink(url: string): string {
  let fim = url.length
  for (;;) {
    const c = url[fim - 1]
    if (c && '.,;:!?\'"*_'.includes(c)) {
      fim -= 1
      continue
    }
    // ")" final só fica se abrir "(" dentro do próprio endereço (Wikipedia)
    if (c === ')') {
      const trecho = url.slice(0, fim)
      const abre = (trecho.match(/\(/g) ?? []).length
      const fecha = (trecho.match(/\)/g) ?? []).length
      if (fecha > abre) {
        fim -= 1
        continue
      }
    }
    break
  }
  return url.slice(0, fim)
}

function juntarTexto(nos: NoInline[], texto: string) {
  if (!texto) return
  const ultimo = nos[nos.length - 1]
  if (ultimo?.tipo === 'texto') ultimo.texto += texto
  else nos.push({ tipo: 'texto', texto })
}

/** Uma linha de texto → nós inline. `dentroDeLink` impede link dentro de
 *  link (o rótulo pode ter negrito, mas não outro endereço). */
export function analisarInline(
  linha: string,
  opcoes: OpcoesAnalise = {},
  dentroDeLink = false,
): NoInline[] {
  const nos: NoInline[] = []
  const re = new RegExp(PADRAO_INLINE.source, PADRAO_INLINE.flags)
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(linha)) !== null) {
    const inicio = m.index
    const [inteiro, mencao, rotulo, endereco, solto, negrito, , italico] = m

    if (mencao !== undefined) {
      if (!opcoes.mencoes) continue // sem resolução: segue como texto
      juntarTexto(nos, linha.slice(cursor, inicio))
      nos.push({ tipo: 'mencao', chave: mencao.slice(2, -1), bruto: mencao })
      cursor = inicio + inteiro.length
      continue
    }

    if (rotulo !== undefined && endereco !== undefined) {
      const href = dentroDeLink ? null : hrefSeguro(endereco)
      if (!href) continue // esquema recusado: o texto aparece como foi escrito
      juntarTexto(nos, linha.slice(cursor, inicio))
      nos.push({ tipo: 'link', href, filhos: analisarInline(rotulo, opcoes, true) })
      cursor = inicio + inteiro.length
      continue
    }

    if (solto !== undefined) {
      const url = aparaFimDeLink(solto)
      const href = dentroDeLink ? null : hrefSeguro(url)
      if (!href) {
        // devolve o que sobrou depois do endereço aparado para a busca
        re.lastIndex = inicio + Math.max(url.length, 1)
        continue
      }
      juntarTexto(nos, linha.slice(cursor, inicio))
      nos.push({ tipo: 'link', href, filhos: [{ tipo: 'texto', texto: url }] })
      cursor = inicio + url.length
      re.lastIndex = cursor
      continue
    }

    if (negrito !== undefined) {
      juntarTexto(nos, linha.slice(cursor, inicio))
      nos.push({ tipo: 'negrito', filhos: analisarInline(negrito, opcoes, dentroDeLink) })
      cursor = inicio + inteiro.length
      continue
    }

    if (italico !== undefined) {
      juntarTexto(nos, linha.slice(cursor, inicio))
      nos.push({ tipo: 'italico', filhos: analisarInline(italico, opcoes, dentroDeLink) })
      cursor = inicio + inteiro.length
    }
  }
  juntarTexto(nos, linha.slice(cursor))
  return nos
}

const ITEM_MARCADO = /^ {0,3}[-*] +(\S.*)$/
const ITEM_NUMERADO = /^ {0,3}(\d{1,3})[.)] +(\S.*)$/

/**
 * Texto inteiro → blocos. Linhas seguidas de lista viram UMA lista; linha em
 * branco ou linha comum encerra a lista. O resto vira parágrafo com as quebras
 * de linha preservadas — o mesmo desenho que a mensagem sem formatação sempre
 * teve.
 */
export function analisarTexto(texto: string, opcoes: OpcoesAnalise = {}): Bloco[] {
  const blocos: Bloco[] = []
  const linhas = (texto ?? '').replace(/\r\n?/g, '\n').split('\n')

  for (const linha of linhas) {
    const marcado = linha.match(ITEM_MARCADO)
    const numerado = marcado ? null : linha.match(ITEM_NUMERADO)
    const ultimo = blocos[blocos.length - 1]

    if (marcado || numerado) {
      const ordenada = Boolean(numerado)
      const conteudo = analisarInline((marcado ?? numerado)![marcado ? 1 : 2], opcoes)
      if (ultimo?.tipo === 'lista' && ultimo.ordenada === ordenada) {
        ultimo.itens.push(conteudo)
      } else {
        blocos.push({
          tipo: 'lista',
          ordenada,
          inicio: numerado ? Number(numerado[1]) : 1,
          itens: [conteudo],
        })
      }
      continue
    }

    if (ultimo?.tipo === 'paragrafo') ultimo.linhas.push(analisarInline(linha, opcoes))
    else blocos.push({ tipo: 'paragrafo', linhas: [analisarInline(linha, opcoes)] })
  }

  // Linha em branco colada numa lista vira espaço da própria lista (margem),
  // não uma linha vazia a mais no parágrafo vizinho.
  return blocos
    .map((b, i) => {
      if (b.tipo !== 'paragrafo') return b
      let linhasB = b.linhas
      const vazia = (l: NoInline[]) => l.length === 0
      if (blocos[i - 1]?.tipo === 'lista') {
        while (linhasB.length && vazia(linhasB[0])) linhasB = linhasB.slice(1)
      }
      if (blocos[i + 1]?.tipo === 'lista') {
        while (linhasB.length && vazia(linhasB[linhasB.length - 1])) linhasB = linhasB.slice(0, -1)
      }
      return { ...b, linhas: linhasB }
    })
    .filter((b) => b.tipo !== 'paragrafo' || b.linhas.length > 0)
}

/** Diz se o texto usa alguma formatação — a prévia só vale o clique quando usa. */
export function temFormatacao(texto: string): boolean {
  return analisarTexto(texto).some(
    (b) => b.tipo === 'lista' || b.linhas.some((l) => l.some((n) => n.tipo !== 'texto')),
  )
}

function textoDosNos(nos: NoInline[], nomeDaMencao?: (chave: string) => string | undefined): string {
  return nos
    .map((n) => {
      if (n.tipo === 'texto') return n.texto
      if (n.tipo === 'mencao') {
        const nome = nomeDaMencao?.(n.chave)
        return nome ? `@${nome}` : n.bruto
      }
      if (n.tipo === 'link') {
        const rotulo = textoDosNos(n.filhos, nomeDaMencao)
        const destino = n.href.replace(/^mailto:/i, '')
        return rotulo === n.href || rotulo === destino ? rotulo : `${rotulo} (${destino})`
      }
      return textoDosNos(n.filhos, nomeDaMencao)
    })
    .join('')
}

/**
 * O mesmo texto sem os marcadores — para onde só cabe uma linha crua (prévia
 * de resposta agendada, lista, notificação). Lista vira "• item" / "1. item".
 */
export function paraTextoSimples(
  texto: string,
  nomeDaMencao?: (chave: string) => string | undefined,
): string {
  return analisarTexto(texto, { mencoes: Boolean(nomeDaMencao) })
    .map((b) =>
      b.tipo === 'paragrafo'
        ? b.linhas.map((l) => textoDosNos(l, nomeDaMencao)).join('\n')
        : b.itens
            .map((item, i) =>
              `${b.ordenada ? `${b.inicio + i}.` : '•'} ${textoDosNos(item, nomeDaMencao)}`,
            )
            .join('\n'),
    )
    .join('\n')
}
