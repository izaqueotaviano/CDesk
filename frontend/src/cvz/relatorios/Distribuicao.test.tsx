import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Distribuicao, tomDaFatia } from './Distribuicao'

const BARRA = 'relatorios-distribuicao__barra'

function classesDasBarras() {
  return screen
    .getAllByRole('listitem')
    .map((li) => li.querySelector(`.${BARRA}`)?.className ?? '')
}

describe('Distribuicao — cor por esquema', () => {
  it('série categórica: um tom de identidade por posição, ciclando; balde fica neutro', () => {
    const itens = [
      ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((label, i) => ({ label, value: 10 - i })),
      { label: 'Outros', value: 1 },
    ]
    render(<Distribuicao titulo="Por empresa" esquema="categorias" itens={itens} />)

    const classes = classesDasBarras()
    expect(classes.slice(0, 6)).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => `${BARRA} ${BARRA}--identidade-${n}`),
    )
    // sétima barra volta ao primeiro tom — nunca repete a vizinha
    expect(classes[6]).toBe(`${BARRA} ${BARRA}--identidade-1`)
    expect(classes[7]).toBe(`${BARRA} ${BARRA}--neutra`)
  })

  it('"Não informada" e "Sem responsável" também são balde', () => {
    render(
      <Distribuicao
        titulo="Resolvidos por agente"
        esquema="categorias"
        itens={[
          { label: 'Sem responsável', value: 3 },
          { label: 'Bruno', value: 2 },
          { label: 'Não informada', value: 1 },
        ]}
      />,
    )
    expect(classesDasBarras()).toEqual([
      `${BARRA} ${BARRA}--neutra`,
      `${BARRA} ${BARRA}--identidade-2`,
      `${BARRA} ${BARRA}--neutra`,
    ])
  })

  it('status segue as colunas de fábrica: novo violeta, aberto azul, aguardando âmbar, fechado cinza', () => {
    render(
      <Distribuicao
        titulo="Por status"
        esquema="status"
        itens={[
          { key: 'new', label: 'Novo', value: 1 },
          { key: 'open', label: 'Aberto', value: 1 },
          { key: 'pending_customer', label: 'Aguardando retorno', value: 1 },
          { key: 'closed', label: 'Fechado', value: 1 },
        ]}
      />,
    )
    expect(classesDasBarras()).toEqual([
      `${BARRA} ${BARRA}--identidade-1`,
      BARRA,
      `${BARRA} ${BARRA}--atencao`,
      `${BARRA} ${BARRA}--neutra`,
    ])
  })

  it('prioridade: baixa cinza, normal azul, alta âmbar, urgente vermelho', () => {
    render(
      <Distribuicao
        titulo="Por prioridade"
        esquema="prioridade"
        itens={[
          { key: 'low', label: 'Baixa', value: 1 },
          { key: 'normal', label: 'Normal', value: 1 },
          { key: 'high', label: 'Alta', value: 1 },
          { key: 'urgent', label: 'Urgente', value: 1 },
        ]}
      />,
    )
    expect(classesDasBarras()).toEqual([
      `${BARRA} ${BARRA}--neutra`,
      BARRA,
      `${BARRA} ${BARRA}--atencao`,
      `${BARRA} ${BARRA}--perigo`,
    ])
  })

  it('SLA: no prazo verde, fora vermelho, aguardando âmbar, sem SLA/indefinido cinza', () => {
    expect(tomDaFatia('sla', { key: 'on_time', label: '', value: 1 }, 0)).toBe('sucesso')
    expect(tomDaFatia('sla', { key: 'late', label: '', value: 1 }, 0)).toBe('perigo')
    expect(tomDaFatia('sla', { key: 'waiting', label: '', value: 1 }, 0)).toBe('atencao')
    expect(tomDaFatia('sla', { key: 'no_sla', label: '', value: 1 }, 0)).toBe('neutra')
    expect(tomDaFatia('sla', { key: 'undefined', label: '', value: 1 }, 0)).toBe('neutra')
  })

  it('fatia sem chave (ou chave desconhecida) num esquema semântico cai no azul padrão', () => {
    render(
      <Distribuicao
        titulo="Por status"
        esquema="status"
        itens={[
          { label: 'Fechado', value: 15 },
          { key: 'inventado', label: 'Outro', value: 1 },
        ]}
      />,
    )
    expect(classesDasBarras()).toEqual([BARRA, BARRA])
  })

  it('sem dados, mostra o texto de vazio no lugar da lista', () => {
    render(<Distribuicao titulo="Por categoria" esquema="categorias" itens={[{ label: 'X', value: 0 }]} />)
    expect(screen.getByText('Sem dados no período.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })
})
