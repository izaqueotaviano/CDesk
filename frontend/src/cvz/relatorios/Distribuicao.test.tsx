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
  it('série categórica: uma cor só (o acento), e o balde fica neutro', () => {
    const itens = [
      ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((label, i) => ({ label, value: 10 - i })),
      { label: 'Outros', value: 1 },
    ]
    render(<Distribuicao titulo="Por empresa" esquema="categorias" itens={itens} />)

    const classes = classesDasBarras()
    // o rótulo já diz qual barra é qual: cor por posição era decoração
    expect(classes.slice(0, 7)).toEqual(Array(7).fill(BARRA))
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
    expect(classesDasBarras()).toEqual([`${BARRA} ${BARRA}--neutra`, BARRA, `${BARRA} ${BARRA}--neutra`])
  })

  it('status: novo e aberto no acento, aguardando âmbar (pede atenção), fechado cinza', () => {
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
    expect(classesDasBarras()).toEqual([BARRA, BARRA, `${BARRA} ${BARRA}--atencao`, `${BARRA} ${BARRA}--neutra`])
  })

  it('prioridade: baixa cinza, normal no acento, alta âmbar, urgente vermelho', () => {
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
    expect(tomDaFatia('sla', { key: 'on_time', label: '', value: 1 })).toBe('sucesso')
    expect(tomDaFatia('sla', { key: 'late', label: '', value: 1 })).toBe('perigo')
    expect(tomDaFatia('sla', { key: 'waiting', label: '', value: 1 })).toBe('atencao')
    expect(tomDaFatia('sla', { key: 'no_sla', label: '', value: 1 })).toBe('neutra')
    expect(tomDaFatia('sla', { key: 'undefined', label: '', value: 1 })).toBe('neutra')
  })

  it('fatia sem chave (ou chave desconhecida) num esquema semântico cai no acento', () => {
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
