import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TicketsTable } from './TicketsTable'
import type { EstadoSla, TicketLinha } from './tipos'

function linha(id: number, sla: { state: EstadoSla; minutes_left: number | null }): TicketLinha {
  return {
    id,
    reference: `T-000${id}`,
    subject: `Assunto ${id}`,
    status: 'open',
    stage_name: 'Em andamento',
    stage_color: '#888',
    priority: 'normal',
    source: 'web',
    requester_display: 'Cliente X',
    company_name: 'Empresa X',
    assignee_name: null,
    category_name: null,
    current_status_note: null,
    sla: {
      first_response: { due_at: null, state: 'none', minutes_left: null },
      // due_at cheio de propósito: é ele que vira o `title` da célula
      resolution: { due_at: '2026-09-06T18:00:00.000Z', ...sla },
    },
    first_response_at: null,
    created_at: '2026-09-06T12:00:00.000Z',
    is_restricted: false,
  }
}

function montar(props: Partial<Parameters<typeof TicketsTable>[0]> = {}) {
  const padrao = {
    linhas: [linha(1, { state: 'at_risk' as EstadoSla, minutes_left: 90 })],
    ordering: '-criado',
    onOrdenar: vi.fn(),
    selecionados: new Set<number>(),
    onSelecionar: vi.fn(),
    onSelecionarTodos: vi.fn(),
    onAbrir: vi.fn(),
    agoraMs: Date.parse('2026-09-06T13:00:00.000Z'),
  }
  const finais = { ...padrao, ...props }
  render(<TicketsTable {...finais} />)
  return finais
}

describe('TicketsTable — coluna de SLA', () => {
  it('mostra o prazo de cada linha sem precisar abrir o chamado', () => {
    montar({
      linhas: [
        linha(1, { state: 'at_risk', minutes_left: 90 }),
        linha(2, { state: 'breached', minutes_left: -30 }),
        linha(3, { state: 'none', minutes_left: null }),
      ],
    })

    expect(screen.getByText('1h — em risco')).toBeInTheDocument()
    expect(screen.getByText('Estourado')).toBeInTheDocument()
    expect(screen.getByText('Sem SLA')).toBeInTheDocument()
  })

  it('prazo cumprido lê "Cumprido", não um tempo negativo', () => {
    // O relógio parado continua devolvendo minutes_left negativo (o
    // serializer calcula due_at - agora); a fila mostra fechados nas visões
    // "Todos" e "Resolvidos", onde isto aparecia como "-3h restantes".
    montar({ linhas: [linha(1, { state: 'met', minutes_left: -180 })] })

    expect(screen.getByText('Cumprido')).toBeInTheDocument()
    expect(screen.queryByText(/-3h/)).not.toBeInTheDocument()
  })

  it('a data cheia do vencimento fica no title da célula', () => {
    montar({ linhas: [linha(1, { state: 'at_risk', minutes_left: 90 })] })

    expect(screen.getByText('1h — em risco')).toHaveAttribute('title', expect.stringContaining('Prazo: '))
  })

  it('clicar no cabeçalho SLA pede a ordenação por prazo', () => {
    const { onOrdenar } = montar()

    fireEvent.click(screen.getByRole('button', { name: /^SLA/ }))

    expect(onOrdenar).toHaveBeenCalledWith('sla')
  })
})

describe('TicketsTable — caixa de selecionar do cabeçalho', () => {
  it('diz quantas linhas desta página ela marca, não "todos"', () => {
    montar({
      linhas: [linha(1, { state: 'ok', minutes_left: 300 }), linha(2, { state: 'ok', minutes_left: 300 })],
    })

    expect(screen.getByRole('checkbox', { name: 'Selecionar os 2 tickets desta página' })).toBeInTheDocument()
  })

  it('com parte das linhas marcada fica indeterminada, não vazia', () => {
    montar({
      linhas: [linha(1, { state: 'ok', minutes_left: 300 }), linha(2, { state: 'ok', minutes_left: 300 })],
      selecionados: new Set([1]),
    })

    const caixa = screen.getByRole('checkbox', { name: /desta página/ }) as HTMLInputElement
    expect(caixa.indeterminate).toBe(true)
    expect(caixa.checked).toBe(false)
  })

  it('com a página inteira marcada fica marcada e sem estado parcial', () => {
    montar({
      linhas: [linha(1, { state: 'ok', minutes_left: 300 }), linha(2, { state: 'ok', minutes_left: 300 })],
      selecionados: new Set([1, 2]),
    })

    const caixa = screen.getByRole('checkbox', { name: /desta página/ }) as HTMLInputElement
    expect(caixa.checked).toBe(true)
    expect(caixa.indeterminate).toBe(false)
  })
})
