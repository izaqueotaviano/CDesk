import { useEffect, useRef, useState, type DragEvent } from 'react'

/**
 * Arrastar arquivos para uma área (o compositor do detalhe, o campo de
 * mensagem da abertura). Devolve os handlers para espalhar no elemento e se
 * há um arrasto de ARQUIVO em cima dele agora — é o que acende a zona de
 * soltar.
 *
 * O contador existe porque `dragenter`/`dragleave` disparam de novo a cada
 * filho que o cursor cruza: sem ele, passar por cima do textarea apagava a
 * zona no meio do gesto. Arrasto de texto selecionado (não de arquivo) passa
 * direto — soltar texto no campo continua sendo colar texto.
 */
export function useSoltarArquivos(aoSoltar: (arquivos: File[]) => void, ativo = true) {
  const [arrastando, setArrastando] = useState(false)
  const profundidade = useRef(0)

  const temArquivo = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  const props = {
    onDragEnter: (e: DragEvent) => {
      if (!ativo || !temArquivo(e)) return
      e.preventDefault()
      profundidade.current += 1
      setArrastando(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!ativo || !temArquivo(e)) return
      // sem preventDefault no dragover o navegador não deixa soltar — e abre
      // o arquivo na aba, jogando fora o que a pessoa escreveu
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: DragEvent) => {
      if (!ativo || !temArquivo(e)) return
      profundidade.current = Math.max(0, profundidade.current - 1)
      if (profundidade.current === 0) setArrastando(false)
    },
    onDrop: (e: DragEvent) => {
      if (!ativo || !temArquivo(e)) return
      e.preventDefault()
      profundidade.current = 0
      setArrastando(false)
      const arquivos = Array.from(e.dataTransfer.files ?? [])
      if (arquivos.length > 0) aoSoltar(arquivos)
    },
  }

  return { arrastando: ativo && arrastando, props }
}

/**
 * Miniatura local (blob:) de cada imagem escolhida, antes de enviar. A URL é
 * criada uma vez por arquivo e revogada quando ele sai da lista (ou a tela
 * desmonta) — cada `createObjectURL` segura o arquivo inteiro na memória até
 * ser revogado.
 */
export function usePreviasDeImagem(arquivos: File[]): Map<File, string> {
  // A URL de cada arquivo sobrevive às mudanças da lista (somar um anexo não
  // recria as miniaturas dos outros, que piscariam); só a de quem saiu é
  // revogada.
  const cache = useRef(new Map<File, string>())
  const [previas, setPrevias] = useState<Map<File, string>>(() => new Map())

  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return // jsdom, navegador velho
    const atual = cache.current
    for (const f of arquivos) {
      if (f.type.startsWith('image/') && !atual.has(f)) atual.set(f, URL.createObjectURL(f))
    }
    for (const [f, url] of [...atual]) {
      if (!arquivos.includes(f)) {
        URL.revokeObjectURL(url)
        atual.delete(f)
      }
    }
    // a URL é recurso externo (blob), criado e revogado aqui; derivar no render vazaria
    setPrevias(new Map(atual))
  }, [arquivos])

  useEffect(() => {
    const atual = cache.current
    return () => {
      atual.forEach((url) => URL.revokeObjectURL(url))
      atual.clear()
    }
  }, [])

  return previas
}
