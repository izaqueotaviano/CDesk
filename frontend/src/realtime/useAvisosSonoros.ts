import { useEffect } from 'react'
import { iniciarAvisosSonoros } from './avisosSonoros'

/** Chame de dentro de um shell autenticado (junto do `useCanalPessoal`):
 *  o som depende dos eventos do canal pessoal. Idempotente. */
export function useAvisosSonoros() {
  useEffect(() => {
    iniciarAvisosSonoros()
  }, [])
}
