import { useEffect, useRef } from 'react'
import { ouvirPedidosDoCompositor, useDigitacaoLocal, type ModoCompositor } from './canalCompositor'

/** Sem tecla por este tempo, a pessoa parou de digitar (para os colegas). */
export const OCIOSO_MS = 6_000

interface Opcoes {
  /** O conteúdo atual do compositor — texto puro ou HTML, tanto faz: só a
   *  MUDANÇA dele é lida, nunca o conteúdo. */
  texto: string
  /** true = resposta ao cliente; false = nota interna. */
  publico: boolean
  /** Os atalhos `r`/`n` pedem um modo: o compositor troca e foca o campo. */
  aoPedirModo: (paraPublico: boolean) => void
}

/**
 * A ÚNICA coisa que o compositor precisa chamar para a colaboração no
 * detalhe funcionar:
 *
 *  1. "digitando": cada mudança do texto acende o estado (resposta ou nota)
 *     por `OCIOSO_MS`; texto vazio, envio (o texto zera) ou sair da tela
 *     apagam na hora. Rascunho restaurado ao montar NÃO conta — ninguém está
 *     digitando só porque abriu a tela;
 *  2. os pedidos de `r`/`n` chegam por `aoPedirModo`.
 */
export function useCompositorColaborativo(ticketId: number, { texto, publico, aoPedirModo }: Opcoes) {
  const relatar = useDigitacaoLocal((s) => s.relatar)
  const textoVisto = useRef(texto)
  // O relógio de ociosidade mora em ref, não no cleanup do efeito: trocar de
  // modo (resposta ↔ nota) re-roda o efeito sem o texto ter mudado, e um
  // cleanup ali cancelaria o "parei" — o aviso ficaria aceso para sempre.
  const ocioso = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const digitando = useRef(false)
  const modo: ModoCompositor = publico ? 'resposta' : 'nota'

  useEffect(() => {
    if (texto === textoVisto.current) {
      // só o modo mudou: quem já estava digitando passa a digitar no outro
      if (digitando.current) relatar(ticketId, modo)
      return
    }
    textoVisto.current = texto
    clearTimeout(ocioso.current)
    if (!texto.trim()) {
      digitando.current = false
      relatar(ticketId, null)
      return
    }
    digitando.current = true
    relatar(ticketId, modo)
    ocioso.current = setTimeout(() => {
      digitando.current = false
      relatar(ticketId, null)
    }, OCIOSO_MS)
  }, [texto, modo, ticketId, relatar])

  useEffect(
    () => () => {
      clearTimeout(ocioso.current)
      digitando.current = false
      relatar(ticketId, null)
    },
    [ticketId, relatar],
  )

  const pedidoRef = useRef(aoPedirModo)
  useEffect(() => {
    pedidoRef.current = aoPedirModo
  })
  useEffect(
    () => ouvirPedidosDoCompositor(ticketId, (pedido) => pedidoRef.current(pedido === 'resposta')),
    [ticketId],
  )
}
