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

  // Gravação de saída: trocar de nota ou fechar o modal não pode levar
  // junto o que foi digitado dentro da janela do debounce — isto roda no
  // DESMONTE do componente (troca de nota, fechar o modal, sair da rota).
  useEffect(() => () => void gravarRef.current(), [])

  // Recarregar a aba, fechar ou digitar outra URL NÃO desmonta nada — é
  // navegação de verdade, o `useEffect` acima nunca chega a rodar, e foi
  // assim que a pessoa perdeu texto escrito segundos antes de apertar F5.
  // `beforeunload` é o único aviso que esse caminho tem: dispara a gravação
  // JÁ (não espera o resto do debounce) e pede confirmação — o navegador
  // pausa a saída pro diálogo, e é nessa pausa que a gravação em voo tem a
  // chance de terminar antes da aba morrer de verdade. Sem nada pendente,
  // nem entra aqui. Mesmo idioma de `PaginaNovoTicket.tsx` (só
  // `preventDefault`; navegador nenhum deixa customizar o texto do aviso).
  useEffect(() => {
    if (estado === 'ocioso' || estado === 'salvo') return
    function aoSair(e: BeforeUnloadEvent) {
      void gravarRef.current()
      e.preventDefault()
    }
    window.addEventListener('beforeunload', aoSair)
    return () => window.removeEventListener('beforeunload', aoSair)
  }, [estado])

  return { estado, salvarAgora: () => void gravarRef.current() }
}
