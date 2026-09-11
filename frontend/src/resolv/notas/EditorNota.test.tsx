import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Nota } from '@/api/notas'
import { EditorNota } from './EditorNota'

function nota(extra: Partial<Nota> = {}): Nota {
  return {
    id: 7,
    title: 'Roteiro da reunião',
    excerpt: 'Combinar o SLA',
    content: 'Combinar o SLA com a Ana.\nRamal 2231.',
    tags: [{ id: 1, name: 'Urgente', slug: 'urgente' }],
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

let detalhe: { data?: Nota; isLoading: boolean; isError: boolean }
const restaurar = vi.fn()
let valoresVistos: unknown
let estado = 'ocioso'

vi.mock('@/api/notas', () => ({
  useNota: () => ({ ...detalhe, refetch: vi.fn() }),
  useAcoesNota: () => ({ restaurar: { mutate: restaurar, isPending: false } }),
}))

vi.mock('./autosave', () => ({
  useAutosave: (args: { valores: unknown }) => {
    valoresVistos = args.valores
    return { estado, salvarAgora: vi.fn() }
  },
}))

// O CKEditor de verdade não monta em jsdom (depende de layout/seleção que só
// um navegador real tem — conferido ao vivo com Playwright, não aqui). O
// mock preserva a MESMA superfície pro teste: rótulo, valor, `onChange`.
vi.mock('./EditorConteudo', () => ({
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

beforeEach(() => {
  vi.clearAllMocks()
  detalhe = { data: nota(), isLoading: false, isError: false }
  estado = 'ocioso'
})

describe('EditorNota', () => {
  it('abre com o corpo INTEIRO, não com o trecho', () => {
    render(<EditorNota notaId={7} />)

    expect(screen.getByLabelText('Conteúdo da nota')).toHaveValue(
      'Combinar o SLA com a Ana.\nRamal 2231.',
    )
  })

  it('mostra as etiquetas como texto editável', () => {
    render(<EditorNota notaId={7} />)

    expect(screen.getByLabelText('Etiquetas da nota')).toHaveValue('Urgente')
  })

  it('entrega ao autosave as etiquetas separadas por vírgula', async () => {
    render(<EditorNota notaId={7} />)

    await userEvent.clear(screen.getByLabelText('Etiquetas da nota'))
    await userEvent.type(screen.getByLabelText('Etiquetas da nota'), 'urgente, cliente')

    expect(valoresVistos).toMatchObject({ tagNames: ['urgente', 'cliente'] })
  })

  it('a vírgula solta no fim não vira etiqueta vazia', async () => {
    // Digitar "urgente," e parar para pensar é o caso comum; uma etiqueta em
    // branco no meio do caminho não pode virar erro de salvamento.
    render(<EditorNota notaId={7} />)

    await userEvent.clear(screen.getByLabelText('Etiquetas da nota'))
    await userEvent.type(screen.getByLabelText('Etiquetas da nota'), 'urgente, ')

    expect(valoresVistos).toMatchObject({ tagNames: ['urgente'] })
  })

  it('anuncia o estado do salvamento', () => {
    estado = 'salvando'
    render(<EditorNota notaId={7} />)

    expect(screen.getByRole('status')).toHaveTextContent('Salvando…')
  })

  it('erro de salvamento vira alerta com "tentar de novo"', () => {
    estado = 'erro'
    render(<EditorNota notaId={7} />)

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível salvar/i)
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
  })

  it('nota na lixeira é só leitura', () => {
    detalhe.data = nota({ is_deleted: true })
    render(<EditorNota notaId={7} />)

    expect(screen.queryByLabelText('Conteúdo da nota')).not.toBeInTheDocument()
    expect(screen.getByText(/está na lixeira/i)).toBeInTheDocument()
    // o corpo continua legível, só não editável
    expect(screen.getByText(/Ramal 2231/)).toBeInTheDocument()
  })

  it('lixeira renderiza o corpo como HTML de verdade, não como texto de tag crua', () => {
    // `content` já chega saneado pelo backend (`nh3`, na escrita) — renderizar
    // de novo como nó de texto mostraria "<strong>SLA</strong>" na tela em
    // vez de "SLA" em negrito. Ver a docstring do modelo e
    // `portal/ajuda/PaginaArtigo.tsx` para o mesmo raciocínio com artigos.
    detalhe.data = nota({ is_deleted: true, content: '<p>Falar sobre o <strong>SLA</strong>.</p>' })
    const { container } = render(<EditorNota notaId={7} />)

    expect(container.querySelector('strong')).toHaveTextContent('SLA')
    expect(screen.queryByText('<strong>SLA</strong>')).not.toBeInTheDocument()
  })

  it('mostra o chamado vinculado quando ele ainda está no meu escopo', () => {
    detalhe.data = nota({ ticket: 42, ticket_reference: 'TD-00042', ticket_subject: 'Impressora' })
    render(<EditorNota notaId={7} />)

    expect(screen.getByRole('link', { name: /TD-00042/ })).toHaveAttribute('href', '/chamados/42')
  })

  it('chamado fora do escopo não aparece — nem o id vira link', () => {
    // O backend zera reference/subject quando o chamado saiu do alcance; a
    // tela não pode inventar um link para algo que a pessoa não pode abrir.
    detalhe.data = nota({ ticket: 42, ticket_reference: null, ticket_subject: null })
    render(<EditorNota notaId={7} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('avisa quando a nota não abre', () => {
    detalhe = { isLoading: false, isError: true }
    render(<EditorNota notaId={7} />)

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível abrir/i)
  })
})
