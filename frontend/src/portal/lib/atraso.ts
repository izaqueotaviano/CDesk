import { useEffect, useState } from 'react'

/** O valor, só depois que ele parou de mudar por `ms` — o "esperar a pessoa
 *  parar de digitar" de toda busca enquanto se escreve. */
export function useValorComAtraso<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor)
  useEffect(() => {
    const h = setTimeout(() => setAtrasado(valor), ms)
    return () => clearTimeout(h)
  }, [valor, ms])
  return atrasado
}
