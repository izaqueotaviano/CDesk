import { useState, type MouseEvent } from 'react'
import { VisualizadorImagem, type ImagemDoVisualizador } from './VisualizadorImagem'

/**
 * O visualizador de imagem pronto para plugar numa lista de anexos: quem usa
 * só diz quais são as imagens, chama `abrir(i)` na miniatura e desenha
 * `elemento` em qualquer lugar (ele vai para o <body> por portal).
 *
 * Existe para a ligação nas quatro telas (chamado e chat, console e portal)
 * caber em poucas linhas no ponto onde cada uma desenha o anexo, sem cada uma
 * reimplementar estado de aberto/fechado.
 */
export function useVisualizadorImagem(imagens: ImagemDoVisualizador[]) {
  const [aberta, setAberta] = useState<number | null>(null)
  const indice = aberta === null ? null : Math.min(aberta, imagens.length - 1)
  const elemento =
    indice !== null && indice >= 0 ? (
      <VisualizadorImagem
        imagens={imagens}
        indice={indice}
        aoFechar={() => setAberta(null)}
        aoTrocar={setAberta}
      />
    ) : null
  return { abrir: (i: number) => setAberta(i), elemento }
}

/**
 * Clique na miniatura que é um LINK para o arquivo: o clique simples abre o
 * visualizador; Ctrl/⌘/Shift/botão do meio continuam fazendo o que o
 * navegador faz com um link (abrir em outra aba, baixar). Assim a miniatura
 * segue sendo um link de verdade — e funciona antes do JavaScript.
 */
export function abrirNoVisualizador(e: MouseEvent, abrir: () => void): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  abrir()
}
