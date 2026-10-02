import { useEffect, useRef } from 'react'
import type { IdAtalho } from './catalogo'
import { registrarAtalhos, type Manipulador, type MapaDeAtalhos } from './registro'

/**
 * Liga atalhos do catálogo enquanto o componente estiver montado.
 *
 *     useAtalhos({
 *       'ticket.responder': () => focarResposta(),
 *       // `undefined`/`false` = não registrado agora (a tecla segue livre
 *       // para quem estiver embaixo na pilha)
 *       'geral.fechar': painelAberto ? () => fecharPainel() : undefined,
 *     })
 *
 * O mapa pode ser um objeto novo a cada render: o registro lê sempre o mais
 * recente por ref, sem se desfazer e refazer (o que perderia uma sequência
 * "g …" no meio). As regras de quando uma tecla vale estão em `registro.ts`.
 */
export function useAtalhos(mapa: MapaDeAtalhos, ativo = true) {
  const mapaRef = useRef(mapa)
  useEffect(() => {
    mapaRef.current = mapa
  })

  useEffect(() => {
    if (!ativo) return
    return registrarAtalhos(() => mapaRef.current)
  }, [ativo])
}

/** Um atalho só — açúcar para `useAtalhos({ [id]: manipulador })`. */
export function useAtalho(id: IdAtalho, manipulador: Manipulador | undefined, ativo = true) {
  useAtalhos({ [id]: manipulador }, ativo)
}
