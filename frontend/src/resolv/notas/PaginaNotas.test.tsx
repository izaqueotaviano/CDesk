import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Etiqueta, FiltroNotas, NotaResumo } from '@/api/notas'
import { PaginaNotas } from './PaginaNotas'

function resumo(extra: Partial<NotaResumo> = {}): NotaResumo {
  return {
    id: 1,
    title: 'Roteiro da reunião',
    excerpt: 'Combinar o SLA',
    tags: [],
    ticket: null,
    ticket_reference: null,
    ticket_subject: null,
    is_pinned: false,
    is_archived: false,
    is_deleted: false,
    created_at: '2026-09-09T10:00:00Z',
    updated_at: '2026-09-09T11:00:00Z',
    ...extra,
  }
}

let lista: {
  data?: { results: NotaResumo[]; count: number }
  isLoading: boolean
  isFetching?: boolean
  isError: boolean
}
let etiquetas: Etiqueta[]
let filtroVisto: FiltroNotas
const criar = vi.fn()
const salvar = vi.fn()
const excluir = vi.fn()
const restaurar = vi.fn()

vi.mock('@/api/notas', () => ({
  useNotas: (f: FiltroNotas) => {
    filtroVisto = f
    return {
      ...lista,
      isFetching: lista.isFetching ?? false,
      refetch: vi.fn(),
      dataUpdatedAt: Date.parse('2026-09-09T12:00:00Z'),
    }
  },
  useEtiquetas: () => ({ data: etiquetas }),
  useAcoesNota: () => ({
    criar: { mutateAsync: criar, isPending: false },
    salvar: { mutate: salvar, mutateAsync: salvar, isPending: false },
    excluir: { mutate: excluir, mutateAsync: excluir, isPending: false },
    restaurar: { mutate: restaurar, mutateAsync: restaurar, isPending: false },
  }),
}))

vi.mock('./EditorNota', () => ({
  EditorNota: ({ notaId }: { notaId: number }) => <div data-testid="editor">nota {notaId}</div>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  lista = { data: { results: [resumo()], count: 1 }, isLoading: false, isError: false }
  etiquetas = []
  criar.mockResolvedValue(resumo({ id: 99, title: 'Sem título' }))
})

describe('PaginaNotas', () => {
  it('lista as notas e diz que são privadas', () => {
    render(<PaginaNotas />)

    expect(screen.getByText('Roteiro da reunião')).toBeInTheDocument()
    expect(screen.getByText(/só você vê/i)).toBeInTheDocument()
  })

  it('começa pelas ativas, sem nota aberta', () => {
    render(<PaginaNotas />)

    expect(filtroVisto.state).toBe('active')
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('abre a nota escolhida num modal', async () => {
    render(<PaginaNotas />)

    await userEvent.click(screen.getByRole('button', { name: /roteiro da reunião/i }))

    const modal = screen.getByRole('dialog')
    expect(modal).toHaveAttribute('aria-modal', 'true')
    expect(within(modal).getByTestId('editor')).toHaveTextContent('nota 1')
  })

  it('fechar o modal volta para a grade sem perder o filtro', async () => {
    render(<PaginaNotas />)
    await userEvent.click(screen.getByRole('button', { name: /roteiro da reunião/i }))

    await userEvent.click(screen.getByRole('button', { name: /fechar nota/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // a grade continua ali, com o mesmo recorte de antes
    expect(screen.getByRole('button', { name: /roteiro da reunião/i })).toBeInTheDocument()
    expect(filtroVisto.state).toBe('active')
  })

  it('Esc fecha a nota aberta', async () => {
    render(<PaginaNotas />)
    await userEvent.click(screen.getByRole('button', { name: /roteiro da reunião/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('o cartão mostra de onde a nota é, e o texto vira prévia', () => {
    lista.data = {
      results: [resumo({ ticket_reference: 'TD-00042', excerpt: 'Combinar o SLA' })],
      count: 1,
    }
    render(<PaginaNotas />)

    const cartao = screen.getByRole('button', { name: /roteiro da reunião/i })
    expect(cartao).toHaveTextContent('TD-00042')
    expect(cartao).toHaveTextContent('Combinar o SLA')
  })

  it('nota sem chamado se anuncia como pessoal', () => {
    render(<PaginaNotas />)

    expect(screen.getByRole('button', { name: /roteiro da reunião/i })).toHaveTextContent(
      'Nota pessoal',
    )
  })

  it('"Nova nota" mora no cabeçalho, não num cartão solto na grade', () => {
    render(<PaginaNotas />)
    const cabecalho = screen.getByRole('banner')
    expect(within(cabecalho).getByRole('heading', { level: 1, name: 'Notas' })).toBeInTheDocument()
    expect(within(cabecalho).getByRole('button', { name: /nova nota/i })).toBeInTheDocument()
    // a grade só tem a nota de verdade
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('o vazio de cada recorte oferece a ação que cabe nele', async () => {
    lista.data = { results: [], count: 0 }
    render(<PaginaNotas />)
    expect(screen.getByRole('button', { name: 'Escrever a primeira nota' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Fixadas' }))
    expect(screen.getByText('Nenhuma nota fixada')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ver notas ativas' }))
    expect(filtroVisto.state).toBe('active')

    // lixeira vazia é o estado bom: nada de convite a escrever
    await userEvent.click(screen.getByRole('tab', { name: 'Lixeira' }))
    expect(screen.getByText(/lixeira está vazia/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Escrever a primeira nota' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver notas ativas' })).not.toBeInTheDocument()
  })

  it('o vazio de um filtro oferece limpar o filtro', async () => {
    lista.data = { results: [], count: 0 }
    etiquetas = [{ id: 1, name: 'Urgente', slug: 'urgente' }]
    render(<PaginaNotas />)

    await userEvent.selectOptions(screen.getByLabelText(/filtrar por etiqueta/i), 'urgente')
    expect(screen.getByText(/nada encontrado com esse filtro/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    await waitFor(() => expect(filtroVisto.tag).toBeUndefined())
    expect(screen.getByText(/nenhuma nota por aqui/i)).toBeInTheDocument()
  })

  it('enquanto carrega, mostra cartões esqueleto em vez de texto', () => {
    lista = { isLoading: true, isError: false }
    render(<PaginaNotas />)

    expect(screen.getByRole('status')).toHaveTextContent('Carregando notas')
    expect(screen.queryByText(/nenhuma nota por aqui/i)).not.toBeInTheDocument()
  })

  it('as setas andam entre os recortes, como num grupo de abas', async () => {
    render(<PaginaNotas />)
    const ativas = screen.getByRole('tab', { name: 'Ativas' })
    expect(ativas).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Fixadas' })).toHaveAttribute('tabindex', '-1')

    ativas.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(filtroVisto.state).toBe('pinned')
    expect(screen.getByRole('tab', { name: 'Fixadas' })).toHaveFocus()

    await userEvent.keyboard('{End}')
    expect(filtroVisto.state).toBe('trash')
    await userEvent.keyboard('{ArrowRight}')
    expect(filtroVisto.state).toBe('active')
  })

  it('troca de recorte', async () => {
    render(<PaginaNotas />)

    await userEvent.click(screen.getByRole('tab', { name: 'Lixeira' }))

    expect(filtroVisto.state).toBe('trash')
  })

  it('a busca espera a pausa na digitação', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<PaginaNotas />)

    await userEvent.type(screen.getByLabelText(/buscar/i), 'reuniao')
    expect(filtroVisto.q).toBeUndefined()

    vi.advanceTimersByTime(300)
    await waitFor(() => expect(filtroVisto.q).toBe('reuniao'))
    vi.useRealTimers()
  })

  it('filtra por etiqueta usando o slug', async () => {
    etiquetas = [{ id: 4, name: 'Urgente', slug: 'urgente' }]
    render(<PaginaNotas />)

    await userEvent.selectOptions(screen.getByLabelText(/filtrar por etiqueta/i), 'urgente')

    expect(filtroVisto.tag).toBe('urgente')
  })

  it('"Nova nota" cria no servidor ANTES de abrir o editor', async () => {
    // O autosave só atualiza. Se a nota nascesse na tela e fosse criada pelo
    // autosave, duas gravações em voo virariam duas notas — e trocar de nota
    // antes da primeira gravação perderia o texto.
    render(<PaginaNotas />)

    await userEvent.click(screen.getByRole('button', { name: /nova nota/i }))

    expect(criar).toHaveBeenCalledWith({ title: 'Sem título', content: '' })
  })

  it('avisa se criar falhar', async () => {
    criar.mockRejectedValue(new Error('rede'))
    render(<PaginaNotas />)

    await userEvent.click(screen.getByRole('button', { name: /nova nota/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível criar/i)
  })

  it('fixar, arquivar e excluir agem sobre a nota aberta', async () => {
    render(<PaginaNotas />)
    await userEvent.click(screen.getByRole('button', { name: /roteiro da reunião/i }))

    await userEvent.click(screen.getByRole('button', { name: 'Fixar' }))
    expect(salvar).toHaveBeenCalledWith({ id: 1, is_pinned: true })

    await userEvent.click(screen.getByRole('button', { name: 'Arquivar' }))
    expect(salvar).toHaveBeenCalledWith({ id: 1, is_archived: true })

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(excluir).toHaveBeenCalledWith(1)
  })

  it('na lixeira, a nota só oferece restaurar', async () => {
    lista.data = { results: [resumo({ is_deleted: true })], count: 1 }
    render(<PaginaNotas />)
    await userEvent.click(screen.getByRole('button', { name: /roteiro da reunião/i }))

    await userEvent.click(screen.getByRole('button', { name: /restaurar/i }))
    expect(restaurar).toHaveBeenCalledWith(1)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('a nota aberta some do editor quando sai do recorte', async () => {
    const { rerender } = render(<PaginaNotas />)
    await userEvent.click(screen.getByRole('button', { name: /roteiro da reunião/i }))
    expect(screen.getByTestId('editor')).toBeInTheDocument()

    lista.data = { results: [], count: 0 }
    rerender(<PaginaNotas />)

    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
  })

  it('o vazio distingue "sem nota" de "nada com esse filtro"', async () => {
    lista.data = { results: [], count: 0 }
    render(<PaginaNotas />)
    expect(screen.getByText(/nenhuma nota por aqui/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Lixeira' }))
    expect(screen.getByText(/lixeira está vazia/i)).toBeInTheDocument()
  })

  it('avisa quando a lista falha', () => {
    lista = { isLoading: false, isError: true }
    render(<PaginaNotas />)

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível carregar/i)
  })

  it('o texto da lista é TEXTO, nunca HTML', () => {
    lista.data = { results: [resumo({ excerpt: '<img src=x onerror=alert(1)>' })], count: 1 }
    const { container } = render(<PaginaNotas />)

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('PaginaNotas — carregar mais', () => {
  it('pede 25 (o padrão do backend) no primeiro carregamento', () => {
    render(<PaginaNotas />)

    expect(filtroVisto.limit).toBe(25)
  })

  it('some quando já trouxe tudo', () => {
    lista.data = { results: [resumo()], count: 1 }
    render(<PaginaNotas />)

    expect(screen.queryByRole('button', { name: /carregar mais/i })).not.toBeInTheDocument()
  })

  it('aparece com quantas faltam, e o clique soma 25 ao limite', async () => {
    lista.data = { results: [resumo()], count: 40 }
    render(<PaginaNotas />)

    const botao = screen.getByRole('button', { name: /carregar mais \(39 restantes\)/i })
    await userEvent.click(botao)

    expect(filtroVisto.limit).toBe(50)
  })

  it('durante a busca, mostra "Carregando…" e não deixa clicar de novo', () => {
    lista.data = { results: [resumo()], count: 40 }
    lista.isFetching = true
    render(<PaginaNotas />)

    const botao = screen.getByRole('button', { name: /carregando/i })
    expect(botao).toBeDisabled()
  })

  it('trocar de recorte reseta o limite — carregar mais numa aba não vaza pra outra', async () => {
    lista.data = { results: [resumo()], count: 40 }
    render(<PaginaNotas />)
    await userEvent.click(screen.getByRole('button', { name: /carregar mais/i }))
    expect(filtroVisto.limit).toBe(50)

    await userEvent.click(screen.getByRole('tab', { name: 'Arquivadas' }))

    expect(filtroVisto.limit).toBe(25)
  })

  it('trocar de etiqueta reseta o limite', async () => {
    etiquetas = [{ id: 4, name: 'Urgente', slug: 'urgente' }]
    lista.data = { results: [resumo()], count: 40 }
    render(<PaginaNotas />)
    await userEvent.click(screen.getByRole('button', { name: /carregar mais/i }))
    expect(filtroVisto.limit).toBe(50)

    await userEvent.selectOptions(screen.getByLabelText(/filtrar por etiqueta/i), 'urgente')

    expect(filtroVisto.limit).toBe(25)
  })

  it('uma busca nova reseta o limite', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    lista.data = { results: [resumo()], count: 40 }
    render(<PaginaNotas />)
    await userEvent.click(screen.getByRole('button', { name: /carregar mais/i }))
    expect(filtroVisto.limit).toBe(50)

    await userEvent.type(screen.getByLabelText(/buscar/i), 'reuniao')
    vi.advanceTimersByTime(300)
    await waitFor(() => expect(filtroVisto.q).toBe('reuniao'))

    expect(filtroVisto.limit).toBe(25)
    vi.useRealTimers()
  })
})
