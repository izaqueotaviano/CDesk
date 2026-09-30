/**
 * Os botões de formatação do compositor, como funções puras sobre o texto.
 *
 * Cada função recebe o texto e a seleção e devolve UMA troca — o trecho
 * `[inicio, fim)` do texto original vira `trecho`, e a seleção passa a ser
 * `selecao`. Devolver a troca (e não o texto inteiro novo) é o que permite
 * aplicá-la com `insertText`, que mantém o Ctrl+Z do navegador funcionando:
 * trocar o `value` do textarea por inteiro apaga o histórico de desfazer.
 *
 * O que cada botão escreve é o subconjunto de `analiseDeTexto.ts` — nada que
 * a renderização não reconheça.
 */

export interface Edicao {
  inicio: number
  fim: number
  trecho: string
  selecao: [number, number]
}

export type Marcador = '**' | '_'

/** Aplica a troca a um texto — o caminho dos testes e do fallback. */
export function aplicarNoTexto(texto: string, e: Edicao): string {
  return texto.slice(0, e.inicio) + e.trecho + texto.slice(e.fim)
}

/**
 * Negrito/itálico. Alterna: aplicar de novo sobre o que já está marcado tira
 * a marca (seja a seleção incluindo os marcadores, seja eles logo em volta).
 * O marcador "abraça" a palavra — espaço nas pontas da seleção fica de fora,
 * senão `** texto**` não seria reconhecido como negrito.
 */
export function envolver(texto: string, inicio: number, fim: number, marcador: Marcador): Edicao {
  const m = marcador.length
  const sel = texto.slice(inicio, fim)

  if (sel.length >= 2 * m + 1 && sel.startsWith(marcador) && sel.endsWith(marcador)) {
    const miolo = sel.slice(m, -m)
    return { inicio, fim, trecho: miolo, selecao: [inicio, inicio + miolo.length] }
  }
  if (
    sel.length > 0 &&
    texto.slice(inicio - m, inicio) === marcador &&
    texto.slice(fim, fim + m) === marcador &&
    // "**" antes de um "_" não é o "_" de fora
    !(marcador === '_' && texto.slice(inicio - m - 1, inicio - m) === '_')
  ) {
    return { inicio: inicio - m, fim: fim + m, trecho: sel, selecao: [inicio - m, fim - m] }
  }
  if (sel.trim().length === 0) {
    const trecho = sel + marcador + marcador
    const cursor = inicio + sel.length + m
    return { inicio, fim, trecho, selecao: [cursor, cursor] }
  }
  const antes = sel.match(/^\s*/)![0]
  const depois = sel.match(/\s*$/)![0]
  const miolo = sel.slice(antes.length, sel.length - depois.length)
  const trecho = antes + marcador + miolo + marcador + depois
  const a = inicio + antes.length + m
  return { inicio, fim, trecho, selecao: [a, a + miolo.length] }
}

const PREFIXO_MARCADO = /^ {0,3}[-*] +/
const PREFIXO_NUMERADO = /^ {0,3}\d{1,3}[.)] +/

/**
 * Lista com marcador ou numerada sobre as linhas que a seleção toca (inteiras).
 * Alterna: se todas as linhas com texto já são itens do mesmo tipo, tira. Trocar
 * de tipo (numerada → marcador) troca o prefixo em vez de empilhar dois.
 */
export function alternarLista(
  texto: string,
  inicio: number,
  fim: number,
  tipo: 'marcada' | 'numerada',
): Edicao {
  const iniLinha = texto.lastIndexOf('\n', inicio - 1) + 1
  // seleção que termina logo depois de uma quebra não "toca" a linha seguinte
  const fimEfetivo = fim > inicio && texto[fim - 1] === '\n' ? fim - 1 : fim
  const quebra = texto.indexOf('\n', fimEfetivo)
  const fimLinha = quebra === -1 ? texto.length : quebra
  const linhas = texto.slice(iniLinha, fimLinha).split('\n')

  const proprio = tipo === 'marcada' ? PREFIXO_MARCADO : PREFIXO_NUMERADO
  const comTexto = linhas.filter((l) => l.trim().length > 0)
  const tirar = comTexto.length > 0 && comTexto.every((l) => proprio.test(l))

  let n = 0
  const novas = linhas.map((l) => {
    if (tirar) return l.replace(proprio, '')
    if (l.trim().length === 0 && linhas.length > 1) return l
    const semPrefixo = l.replace(PREFIXO_MARCADO, '').replace(PREFIXO_NUMERADO, '')
    n += 1
    return (tipo === 'marcada' ? '- ' : `${n}. `) + semPrefixo
  })
  const trecho = novas.join('\n')
  // Uma linha só, sem seleção: o cursor vai para o fim dela (continuar
  // escrevendo o item). Várias linhas: o bloco inteiro fica selecionado.
  const selecao: [number, number] =
    linhas.length === 1 && inicio === fim
      ? [iniLinha + trecho.length, iniLinha + trecho.length]
      : [iniLinha, iniLinha + trecho.length]
  return { inicio: iniLinha, fim: fimLinha, trecho, selecao }
}

/**
 * Enter no fim de um item de lista continua a lista (`- ` ou o próximo
 * número); Enter num item VAZIO encerra a lista, apagando o marcador — o gesto
 * de todo editor de texto. Fora de lista, ou com seleção, devolve `null` e o
 * Enter segue normal.
 */
export function continuarLista(texto: string, inicio: number, fim: number): Edicao | null {
  if (inicio !== fim) return null
  const iniLinha = texto.lastIndexOf('\n', inicio - 1) + 1
  const quebra = texto.indexOf('\n', inicio)
  const fimLinha = quebra === -1 ? texto.length : quebra
  if (inicio !== fimLinha) return null // cursor no meio da linha: Enter comum
  const linha = texto.slice(iniLinha, fimLinha)
  const marcado = linha.match(/^( {0,3})([-*]) +(.*)$/)
  const numerado = marcado ? null : linha.match(/^( {0,3})(\d{1,3})([.)]) +(.*)$/)
  if (!marcado && !numerado) return null
  const conteudo = marcado ? marcado[3] : numerado![4]
  if (!conteudo.trim()) {
    return { inicio: iniLinha, fim: fimLinha, trecho: '', selecao: [iniLinha, iniLinha] }
  }
  const prefixo = marcado
    ? `${marcado[1]}${marcado[2]} `
    : `${numerado![1]}${Number(numerado![2]) + 1}${numerado![3]} `
  const trecho = `\n${prefixo}`
  return { inicio, fim, trecho, selecao: [inicio + trecho.length, inicio + trecho.length] }
}

const PARECE_ENDERECO = /^(?:https?:\/\/|mailto:)\S+$/i

/**
 * Link. Com texto selecionado, ele vira o rótulo e o endereço fica
 * selecionado para colar por cima; com um endereço selecionado, o rótulo é
 * que fica selecionado; sem seleção, os dois vêm com um texto de exemplo.
 */
export function inserirLink(texto: string, inicio: number, fim: number): Edicao {
  const sel = texto.slice(inicio, fim).trim()
  if (PARECE_ENDERECO.test(sel)) {
    const rotulo = 'texto do link'
    return {
      inicio,
      fim,
      trecho: `[${rotulo}](${sel})`,
      selecao: [inicio + 1, inicio + 1 + rotulo.length],
    }
  }
  const rotulo = sel || 'texto do link'
  const endereco = 'https://'
  const trecho = `[${rotulo}](${endereco})`
  if (!sel) return { inicio, fim, trecho, selecao: [inicio + 1, inicio + 1 + rotulo.length] }
  const a = inicio + rotulo.length + 3
  return { inicio, fim, trecho, selecao: [a, a + endereco.length] }
}

/**
 * Aplica a troca no textarea preservando o desfazer. `insertText` dispara o
 * `input` que o React escuta, então o estado acompanha sozinho; onde ele não
 * existe (jsdom, navegador que o recusa) cai no `definir` com o texto novo.
 */
export function aplicarNoCampo(
  campo: HTMLTextAreaElement,
  e: Edicao,
  definir: (texto: string) => void,
): void {
  const original = campo.value
  campo.focus()
  campo.setSelectionRange(e.inicio, e.fim)
  try {
    if (typeof document.execCommand === 'function') {
      if (e.trecho) document.execCommand('insertText', false, e.trecho)
      else if (e.inicio !== e.fim) document.execCommand('delete', false)
    }
  } catch {
    // navegador que recusa o comando: o caminho de baixo resolve
  }
  // Sem efeito (jsdom, comando recusado ou ignorado): troca pelo estado.
  if (campo.value === original) definir(aplicarNoTexto(original, e))
  // a seleção só existe depois de o React desenhar o valor novo
  const depois =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (f: () => void) => window.setTimeout(f, 0)
  depois(() => {
    campo.focus()
    campo.setSelectionRange(e.selecao[0], e.selecao[1])
  })
}
