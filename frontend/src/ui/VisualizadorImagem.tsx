import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react'
import './visualizador-imagem.css'

export interface ImagemDoVisualizador {
  /** Endereço da imagem — o mesmo do download (a view autenticada de anexo). */
  url: string
  nome: string
  /** Linha secundária: tamanho, quem enviou. */
  detalhe?: string
}

interface Props {
  imagens: ImagemDoVisualizador[]
  indice: number
  aoFechar: () => void
  aoTrocar: (indice: number) => void
}

const FOCAVEIS = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Visualizador de imagem (lightbox) compartilhado: console do agente (chamado
 * e chat) e portal do cliente (chamado e chat). Antes, a miniatura abria o
 * arquivo numa aba nova — e quem conferia três prints de um erro saía da
 * conversa três vezes.
 *
 * O que ele garante:
 *  - é um diálogo modal de verdade: foco preso dentro, Esc fecha, o foco volta
 *    para a miniatura que abriu;
 *  - setas ← → passam pelas imagens do mesmo conjunto (a mensagem ou a
 *    conversa, quem abre decide);
 *  - abre AJUSTADO à tela; "100%" mostra o tamanho real com rolagem (é onde
 *    se lê o texto miúdo de um print);
 *  - "Baixar" é o mesmo endereço do anexo, com o nome original;
 *  - fundo escuro nos dois temas — imagem se confere contra neutro escuro, e
 *    é o único lugar do produto que não segue o tema, de propósito;
 *  - sem animação para quem pediu movimento reduzido.
 *
 * Só imagem LIBERADA pela varredura antivírus chega aqui: quem monta a lista é
 * quem já decidiu mostrar a miniatura (D19).
 */
export function VisualizadorImagem({ imagens, indice, aoFechar, aoTrocar }: Props) {
  const idTitulo = useId()
  const painelRef = useRef<HTMLDivElement>(null)
  const fecharRef = useRef<HTMLButtonElement>(null)
  const [tamanhoReal, setTamanhoReal] = useState(false)
  const [falhou, setFalhou] = useState<string | null>(null)
  const [indiceVisto, setIndiceVisto] = useState(indice)

  const total = imagens.length
  const atual = imagens[Math.min(Math.max(indice, 0), total - 1)]

  // Trocar de imagem volta ao "ajustado" — o 100% da anterior não diz nada
  // sobre a próxima. Ajuste durante o render (padrão da casa para derivar de
  // props), não efeito + setState.
  if (indiceVisto !== indice) {
    setIndiceVisto(indice)
    setTamanhoReal(false)
  }

  // Foco inicial no "Fechar" e devolução do foco a quem abriu; rolagem da
  // página travada enquanto aberto (senão a roda rola a conversa por trás).
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null
    fecharRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      anterior?.focus?.()
    }
  }, [])

  if (!atual) return null

  const temVarias = total > 1
  const anterior = () => aoTrocar((indice - 1 + total) % total)
  const proxima = () => aoTrocar((indice + 1) % total)

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      aoFechar()
      return
    }
    if (e.key === 'ArrowLeft' && temVarias) {
      e.preventDefault()
      anterior()
      return
    }
    if (e.key === 'ArrowRight' && temVarias) {
      e.preventDefault()
      proxima()
      return
    }
    if (e.key === '+' || e.key === '=') {
      setTamanhoReal(true)
      return
    }
    if (e.key === '-' || e.key === '0') {
      setTamanhoReal(false)
      return
    }
    if (e.key === 'Tab') {
      const itens = Array.from(painelRef.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? [])
      if (itens.length === 0) return
      const primeiro = itens[0]!
      const ultimo = itens[itens.length - 1]!
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }
  }

  const erroDesta = falhou === atual.url

  return createPortal(
    <div
      ref={painelRef}
      className="visualizador"
      role="dialog"
      aria-modal="true"
      aria-labelledby={idTitulo}
      // focável por clique: clicar na imagem (que não recebe foco) não pode
      // mandar o foco para o <body>, senão Esc e as setas param de chegar aqui
      tabIndex={-1}
      onKeyDown={aoTeclar}
    >
      <header className="visualizador__topo">
        <div className="visualizador__titulo">
          <span id={idTitulo} className="visualizador__nome">
            {atual.nome}
          </span>
          <span className="visualizador__detalhe">
            {[atual.detalhe, temVarias ? `${indice + 1} de ${total}` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <div className="visualizador__acoes">
          <button
            type="button"
            className="visualizador__botao"
            onClick={() => setTamanhoReal((v) => !v)}
            aria-pressed={tamanhoReal}
            disabled={erroDesta}
            title={tamanhoReal ? 'Ajustar à tela (−)' : 'Tamanho real, 100% (+)'}
          >
            {tamanhoReal ? <IconZoomOut aria-hidden="true" /> : <IconZoomIn aria-hidden="true" />}
            <span>{tamanhoReal ? 'Ajustar' : '100%'}</span>
          </button>
          <a
            className="visualizador__botao"
            href={atual.url}
            download={atual.nome}
            title="Baixar o arquivo original"
          >
            <IconDownload aria-hidden="true" />
            <span>Baixar</span>
          </a>
          <button
            ref={fecharRef}
            type="button"
            className="visualizador__botao visualizador__botao--icone"
            onClick={aoFechar}
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            <IconX aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        className={'visualizador__palco' + (tamanhoReal ? ' visualizador__palco--real' : '')}
        // clicar no fundo (fora da imagem) fecha, como em qualquer lightbox
        onClick={(e) => {
          if (e.target === e.currentTarget) aoFechar()
        }}
      >
        {erroDesta ? (
          <p className="visualizador__erro" role="alert">
            Não foi possível mostrar esta imagem. Use “Baixar” para abrir o arquivo.
          </p>
        ) : (
          <img
            key={atual.url}
            className="visualizador__imagem"
            src={atual.url}
            alt={atual.nome}
            onClick={() => setTamanhoReal((v) => !v)}
            onError={() => setFalhou(atual.url)}
          />
        )}
      </div>

      {temVarias && (
        <>
          <button
            type="button"
            className="visualizador__nav visualizador__nav--anterior"
            onClick={anterior}
            aria-label="Imagem anterior"
            title="Imagem anterior (←)"
          >
            <IconChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="visualizador__nav visualizador__nav--proxima"
            onClick={proxima}
            aria-label="Próxima imagem"
            title="Próxima imagem (→)"
          >
            <IconChevronRight aria-hidden="true" />
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
