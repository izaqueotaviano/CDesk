import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Nota, NotaResumo } from '@/api/notas'
import { PainelNotas } from './PainelNotas'

const AGORA = Date.parse('2026-09-09T12:00:00Z')

function resumo(extra: Partial<NotaResumo> = {}): NotaResumo {
  return {
    id: 1,
    title: 'Cliente prefere ligação',
    excerpt: 'Combinar retorno às 14h',
    tags: [],
    ticket: 42,
    ticket_reference: 'TD-00042',
    ticket_subject: 'Impressora fiscal',
    is_pinned: false,
    is_archived: false,
    is_deleted: false,
    created_at: '2026-09-09T10:00:00Z',
    updated_at: '2026-09-09T11:00:00Z',
    ...extra,
  }
}

let lista: { data?: { results: NotaResumo[] }; isLoading: boolean; isError: boolean }
let detalhe: { data?: Nota; isLoading: boolean; isError: boolean }
const criar = vi.fn()
const salvar = vi.fn()
const excluir = vi.fn()
const restaurar = vi.fn()
const recarregar = vi.fn()

vi.mock('@/api/notas', () => ({
  useNotas: () => ({ ...lista, refetch: recarregar }),
  useNota: (id: number | null) => (id === null ? { isLoading: false, isError: false } : detalhe),
  useAcoesNota: () => ({
    criar: { mutateAsync: criar, isPending: false },
    salvar: { mutateAsync: salvar, isPending: false },
    excluir: { mutateAsync: excluir, isPending: false },
    restaurar: { mutateAsync: restaurar, isPending: false },
  }),
}))

// O CKEditor de verdade não monta em jsdom — conferido ao vivo com
// Playwright, não aqui. O mock preserva a mesma superfície de sempre
// (rótulo, valor, `onChange`), mesmo caminho usado por `PainelNotas.tsx`.
vi.mock('../../notas/EditorConteudo', () => ({
  EditorConteudo: ({
    valor,
    onMudar,
    placeholder,
  }: {
    valor: string
    onMudar: (v: string) => void
    placeholder?: string
  }) => (
    <textarea
      aria-label="Conteúdo da nota"
      placeholder={placeholder}
      value={valor}
      onChange={(e) => onMudar(e.target.value)}
    />
  ),
}))

function montar(ticketId = 42) {
  return render(<PainelNotas ticketId={ticketId} agoraMs={AGORA} onFechar={vi.fn()} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  lista = { data: { results: [] }, isLoading: false, isError: false }
  detalhe = { isLoading: false, isError: false }
  criar.mockResolvedValue(resumo())
  salvar.mockResolvedValue(resumo())
  excluir.mockResolvedValue(undefined)
  restaurar.mockResolvedValue(resumo())
})

describe('PainelNotas', () => {
  it('lista as notas do chamado', () => {
    lista.data = { results: [resumo(), resumo({ id: 2, title: 'Peça em falta' })] }
    montar()

    expect(screen.getByText('Cliente prefere ligação')).toBeInTheDocument()
    expect(screen.getByText('Peça em falta')).toBeInTheDocument()
  })

  it('diz que a nota é privada', () => {
    montar()
    expect(screen.getByText(/só você vê/i)).toBeInTheDocument()
  })

  it('mostra o vazio quando não há nota sobre o chamado', () => {
    montar()
    expect(screen.getByText(/nenhuma nota sobre este ticket/i)).toBeInTheDocument()
  })

  it('avisa quando a lista falha e deixa tentar de novo', async () => {
    lista = { isLoading: false, isError: true }
    montar()

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível carregar/i)
    await userEvent.click(screen.getByRole('button', { name: /tentar de novo/i }))
    expect(recarregar).toHaveBeenCalled()
  })

  it('a nota nova já nasce presa a ESTE chamado', async () => {
    montar(77)

    await userEvent.click(screen.getByRole('button', { name: /nova nota/i }))
    await userEvent.type(screen.getByLabelText('Título da nota'), 'Ligar amanhã')
    await userEvent.type(screen.getByLabelText('Conteúdo da nota'), 'depois das 14h')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(criar).toHaveBeenCalledWith({
      title: 'Ligar amanhã',
      content: 'depois das 14h',
      ticket: 77,
    })
  })

  it('não deixa salvar sem título', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: /nova nota/i }))

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('editar carrega o CORPO INTEIRO, não o trecho da lista', async () => {
    // A lista devolve `excerpt` (180 caracteres). Abrir para editar com ele e
    // salvar gravaria a nota truncada — perda de dado silenciosa, e logo na
    // nota longa, que é a que custou mais para escrever.
    lista.data = { results: [resumo({ excerpt: 'Combinar retorno' })] }
    detalhe = {
      data: { ...resumo(), content: 'Combinar retorno às 14h, ramal 2231, falar com a Ana.' },
      isLoading: false,
      isError: false,
    }
    montar()

    await userEvent.click(screen.getByRole('button', { name: /editar/i }))

    const corpo = screen.getByLabelText('Conteúdo da nota')
    expect(corpo).toHaveValue('Combinar retorno às 14h, ramal 2231, falar com a Ana.')

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(salvar).toHaveBeenCalledWith({
      id: 1,
      title: 'Cliente prefere ligação',
      content: 'Combinar retorno às 14h, ramal 2231, falar com a Ana.',
    })
  })

  it('não deixa escrever enquanto o corpo não chegou', async () => {
    lista.data = { results: [resumo()] }
    detalhe = { isLoading: true, isError: false }
    montar()

    await userEvent.click(screen.getByRole('button', { name: /editar/i }))

    expect(screen.queryByLabelText('Conteúdo da nota')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/abrindo a nota/i)
  })

  it('excluir manda para a lixeira e dá para desfazer', async () => {
    lista.data = { results: [resumo()] }
    montar()

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }))
    expect(excluir).toHaveBeenCalledWith(1)

    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(/lixeira/i)

    await userEvent.click(screen.getByRole('button', { name: /desfazer/i }))
    expect(restaurar).toHaveBeenCalledWith(1)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /desfazer/i })).not.toBeInTheDocument(),
    )
  })

  it('avisa quando salvar falha, sem perder o que foi digitado', async () => {
    criar.mockRejectedValue(new Error('rede'))
    montar()

    await userEvent.click(screen.getByRole('button', { name: /nova nota/i }))
    await userEvent.type(screen.getByLabelText('Título da nota'), 'Não perder')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível salvar/i)
    expect(screen.getByLabelText('Título da nota')).toHaveValue('Não perder')
  })

  it('o corpo é TEXTO, nunca HTML', () => {
    // Contrato com o backend: a API guarda e devolve texto puro, sem sanear
    // nem escapar. Quem fecha o XSS é esta tela renderizar como nó de texto.
    lista.data = { results: [resumo({ excerpt: '<img src=x onerror=alert(1)>' })] }
    const { container } = montar()

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })
})
