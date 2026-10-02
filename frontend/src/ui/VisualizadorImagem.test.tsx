import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { VisualizadorImagem } from './VisualizadorImagem'
import { abrirNoVisualizador, useVisualizadorImagem } from './useVisualizadorImagem'

const IMAGENS = [
  { url: '/api/v1/attachments/1/', nome: 'erro-1.png', detalhe: '120 KB' },
  { url: '/api/v1/attachments/2/', nome: 'erro-2.png' },
  { url: '/api/v1/attachments/3/', nome: 'erro-3.png' },
]

/** A galeria como as telas usam: miniaturas que são links, e o visualizador. */
function Galeria() {
  const visualizador = useVisualizadorImagem(IMAGENS)
  return (
    <div>
      {IMAGENS.map((img, i) => (
        <a
          key={img.url}
          href={img.url}
          aria-label={`Ver ${img.nome}`}
          onClick={(e) => abrirNoVisualizador(e, () => visualizador.abrir(i))}
        >
          miniatura
        </a>
      ))}
      {visualizador.elemento}
    </div>
  )
}

describe('VisualizadorImagem', () => {
  it('abre como diálogo modal, com nome, posição e foco no "Fechar"', () => {
    render(<Galeria />)
    fireEvent.click(screen.getByRole('link', { name: 'Ver erro-2.png' }))

    const dialogo = screen.getByRole('dialog', { name: 'erro-2.png' })
    expect(dialogo).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('2 de 3')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'erro-2.png' })).toHaveAttribute('src', IMAGENS[1].url)
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus()
  })

  it('setas passam pelas imagens, dando a volta', () => {
    render(<Galeria />)
    fireEvent.click(screen.getByRole('link', { name: 'Ver erro-3.png' }))
    const dialogo = screen.getByRole('dialog')

    fireEvent.keyDown(dialogo, { key: 'ArrowRight' })
    expect(screen.getByRole('img', { name: 'erro-1.png' })).toBeInTheDocument()
    fireEvent.keyDown(dialogo, { key: 'ArrowLeft' })
    expect(screen.getByRole('img', { name: 'erro-3.png' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Imagem anterior' }))
    expect(screen.getByRole('img', { name: 'erro-2.png' })).toBeInTheDocument()
  })

  it('Esc fecha e devolve o foco à miniatura que abriu', () => {
    render(<Galeria />)
    const miniatura = screen.getByRole('link', { name: 'Ver erro-1.png' })
    miniatura.focus()
    fireEvent.click(miniatura)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(miniatura).toHaveFocus()
  })

  it('o Tab fica preso dentro do diálogo', () => {
    render(<Galeria />)
    fireEvent.click(screen.getByRole('link', { name: 'Ver erro-1.png' }))
    const dialogo = screen.getByRole('dialog')
    const proxima = screen.getByRole('button', { name: 'Próxima imagem' })

    proxima.focus()
    fireEvent.keyDown(dialogo, { key: 'Tab' })
    // depois do último focável, volta ao primeiro (o 100%)
    expect(screen.getByRole('button', { name: /100%/ })).toHaveFocus()
    fireEvent.keyDown(dialogo, { key: 'Tab', shiftKey: true })
    expect(proxima).toHaveFocus()
  })

  it('alterna entre ajustado e 100%, e voltar a outra imagem volta ao ajustado', () => {
    render(<Galeria />)
    fireEvent.click(screen.getByRole('link', { name: 'Ver erro-1.png' }))

    const zoom = screen.getByRole('button', { name: /100%/ })
    expect(zoom).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(zoom)
    expect(screen.getByRole('button', { name: /Ajustar/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: /100%/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('"Baixar" é o arquivo original, com o nome dele', () => {
    render(<Galeria />)
    fireEvent.click(screen.getByRole('link', { name: 'Ver erro-1.png' }))
    const baixar = screen.getByRole('link', { name: /Baixar/ })
    expect(baixar).toHaveAttribute('href', IMAGENS[0].url)
    expect(baixar).toHaveAttribute('download', 'erro-1.png')
  })

  it('clique com Ctrl na miniatura continua abrindo o link (nova aba), sem o visualizador', () => {
    render(<Galeria />)
    fireEvent.click(screen.getByRole('link', { name: 'Ver erro-1.png' }), { ctrlKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uma imagem só: sem setas e sem contador', () => {
    function Uma() {
      const [aberto, setAberto] = useState(true)
      return aberto ? (
        <VisualizadorImagem
          imagens={[IMAGENS[0]]}
          indice={0}
          aoFechar={() => setAberto(false)}
          aoTrocar={vi.fn()}
        />
      ) : null
    }
    render(<Uma />)
    expect(screen.queryByRole('button', { name: 'Próxima imagem' })).not.toBeInTheDocument()
    expect(screen.queryByText(/de 1/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
