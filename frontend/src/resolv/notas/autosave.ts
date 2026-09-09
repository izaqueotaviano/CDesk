import { useEffect, useRef, useState } from 'react'
import { useAcoesNota, type EntradaNota } from '@/api/notas'

/**
 * Autosave de uma nota.
 *
 * Só ATUALIZA — a nota já existe quando o editor abre. Criar dentro do
 * autosave abriria a porta para duas requisições de criação em voo virarem
 * duas notas; a página resolve isso criando a nota no clique de "Nova nota",
 * antes de o editor aparecer (ver `PaginaNotas`).
 *
 * Manda só o que MUDOU. `tag_names` fora do payload não limpa as etiquetas
 * (o backend só mexe em `tags` de quem mandou o campo), então salvar o título
 * não custa um `get_or_create` por etiqueta a cada pausa na digitação.
 */

export type EstadoSalvamento = 'ocioso' | 'pendente' | 'salvando' | 'salvo' | 'erro'

export interface ValoresNota {
  title: string
  content: string
  tagNames: string[]
}

function assinatura(v: ValoresNota): string {
  return JSON.stringify([v.title, v.content, v.tagNames])
}

export function useAutosave({
  notaId,
  valores,
  inicial,
  atraso = 800,
}: {
  notaId: number
  valores: ValoresNota
  /** O que já está no servidor quando o editor abre. */
  inicial: ValoresNota
  atraso?: number
}): { estado: EstadoSalvamento; salvarAgora: () => void } {
  const { salvar } = useAcoesNota()
  const [estado, setEstado] = useState<EstadoSalvamento>('ocioso')

  /** O que o servidor já tem. Só o que difere daqui é mandado. */
  const salvoRef = useRef<ValoresNota>(inicial)
  /** Impede duas gravações em voo: a segunda esperaria a primeira e poderia
   *  chegar fora de ordem, gravando texto mais VELHO por cima do mais novo. */
  const emVooRef = useRef(false)
  /** Alguém digitou enquanto uma gravação estava em voo. */
  const denovoRef = useRef(false)
  /** Últimos valores renderizados — o efeito abaixo mantém isto em dia para
   *  a gravação de saída (desmontagem) não usar texto velho. */
  const valoresRef = useRef(valores)
  useEffect(() => {
    valoresRef.current = valores
  })

  /**
   * A função de gravar vive num ref, não num `useCallback`: ela chama a si
   * mesma na cauda (quando alguém digitou durante a gravação) e um callback
   * memoizado não consegue se referenciar. O ref também é o que deixa o
   * efeito de debounce depender só do TEXTO — sem isso, cada render
   * reiniciaria o cronômetro e o autosave nunca disparava.
   */
  const gravarRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    gravarRef.current = async () => {
      const atual = valoresRef.current
      const salvo = salvoRef.current
      if (assinatura(atual) === assinatura(salvo)) return
      if (emVooRef.current) {
        denovoRef.current = true
        return
      }

      const entrada: EntradaNota & { id: number } = { id: notaId }
      if (atual.title !== salvo.title) entrada.title = atual.title
      if (atual.content !== salvo.content) entrada.content = atual.content
      if (atual.tagNames.join('\u0000') !== salvo.tagNames.join('\u0000')) {
        entrada.tag_names = atual.tagNames
      }

      emVooRef.current = true
      setEstado('salvando')
      try {
        await salvar.mutateAsync(entrada)
        salvoRef.current = atual
        setEstado('salvo')
      } catch {
        setEstado('erro')
      } finally {
        emVooRef.current = false
        if (denovoRef.current) {
          denovoRef.current = false
          await gravarRef.current()
        }
      }
    }
  })

  const assinaturaAtual = assinatura(valores)

  useEffect(() => {
    if (assinaturaAtual === assinatura(salvoRef.current)) return
    setEstado('pendente')
    const t = setTimeout(() => void gravarRef.current(), atraso)
    return () => clearTimeout(t)
  }, [assinaturaAtual, atraso])

  // Gravação de saída: trocar de nota ou sair da tela não pode levar junto o
  // que foi digitado dentro da janela do debounce.
  useEffect(() => () => void gravarRef.current(), [])

  return { estado, salvarAgora: () => void gravarRef.current() }
}
