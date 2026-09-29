import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Rascunho local: o que a pessoa escreveu sobrevive a F5, aba fechada sem
 * querer e à ida até um artigo da Central de Ajuda.
 *
 * Mora no localStorage DESTE navegador, e é de propósito: rascunho não é
 * dado do sistema, é o texto pela metade de alguém — não precisa de servidor,
 * de sincronizar entre aparelhos, nem de sobreviver à troca de computador.
 * A chave leva o id da pessoa: num computador compartilhado, a próxima conta
 * que entrar não herda o texto de outra.
 *
 * Tudo em try/catch: janela anônima, cota cheia ou armazenamento bloqueado
 * fazem `localStorage` lançar, e rascunho que falha só não salva — nunca
 * derruba o formulário.
 */

const PREFIXO = 'resolv:portal:rascunho'
/** Texto de um mês atrás não é rascunho, é resto. */
const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000
/** Salvar a cada tecla seria gravar o disco à toa; meio segundo basta. */
const ATRASO_MS = 400

interface Guardado<T> {
  v: T
  em: number
}

export function chaveDeRascunho(usuarioId: number | undefined, ...partes: (string | number)[]): string | null {
  return usuarioId == null ? null : [PREFIXO, usuarioId, ...partes].join(':')
}

export function lerRascunho<T>(chave: string): T | null {
  try {
    const bruto = window.localStorage.getItem(chave)
    if (!bruto) return null
    const guardado = JSON.parse(bruto) as Guardado<T>
    if (!guardado || typeof guardado.em !== 'number' || Date.now() - guardado.em > VALIDADE_MS) {
      window.localStorage.removeItem(chave)
      return null
    }
    return guardado.v
  } catch {
    return null
  }
}

export function gravarRascunho<T>(chave: string, valor: T): void {
  try {
    window.localStorage.setItem(chave, JSON.stringify({ v: valor, em: Date.now() } satisfies Guardado<T>))
  } catch {
    /* sem espaço ou bloqueado: o rascunho só não fica salvo */
  }
}

export function apagarRascunho(chave: string): void {
  try {
    window.localStorage.removeItem(chave)
  } catch {
    /* idem */
  }
}

/**
 * Liga um formulário ao rascunho.
 *
 * - Ao montar (ou quando a chave aparece — o id da pessoa chega depois do
 *   primeiro render), lê o que havia e entrega a `restaurar`.
 * - Depois, grava `atual` com um respiro; vazio (pelo critério `vazio`)
 *   apaga em vez de guardar um rascunho em branco.
 * - `limpar()` é o "enviado": apaga e cancela o que estava para ser gravado,
 *   senão o texto que acabou de sair voltaria meio segundo depois.
 *
 * `restaurado` é o que a tela usa para o aviso discreto "Rascunho restaurado"
 * — a pessoa precisa saber que o texto ali não surgiu do nada.
 */
export function useRascunho<T>(
  chave: string | null,
  atual: T,
  restaurar: (salvo: T) => void,
  vazio: (valor: T) => boolean,
) {
  const [restaurado, setRestaurado] = useState(false)
  const carregadoDe = useRef<string | null>(null)
  const pendente = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // as funções mudam a cada render (arrow inline de quem chama); guardá-las
  // num ref evita que o efeito de leitura rode de novo por causa delas
  const restaurarRef = useRef(restaurar)
  const vazioRef = useRef(vazio)
  useLayoutEffect(() => {
    restaurarRef.current = restaurar
    vazioRef.current = vazio
  })

  useEffect(() => {
    if (!chave || carregadoDe.current === chave) return
    carregadoDe.current = chave
    const salvo = lerRascunho<T>(chave)
    if (salvo != null && !vazioRef.current(salvo)) {
      restaurarRef.current(salvo)
      setRestaurado(true)
    } else {
      setRestaurado(false)
    }
  }, [chave])

  const serializado = JSON.stringify(atual)
  useEffect(() => {
    if (!chave || carregadoDe.current !== chave) return
    clearTimeout(pendente.current)
    pendente.current = setTimeout(() => {
      const valor = JSON.parse(serializado) as T
      if (vazioRef.current(valor)) apagarRascunho(chave)
      else gravarRascunho(chave, valor)
    }, ATRASO_MS)
    return () => clearTimeout(pendente.current)
  }, [chave, serializado])

  const limpar = useCallback(() => {
    clearTimeout(pendente.current)
    if (chave) apagarRascunho(chave)
    setRestaurado(false)
  }, [chave])

  const esconderAviso = useCallback(() => setRestaurado(false), [])

  return { restaurado, limpar, esconderAviso }
}
