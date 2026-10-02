import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinhaDeCliente } from '@/api/chat'
import type { NavegacaoDaConversa } from './ConversaChat'
import { PaginaChat } from './PaginaChat'

/**
 * As três formas do console pela largura (./layout.ts):
 *
 * - ≥1200px: lista | conversa | painel, e a primeira conversa já abre;
 * - 768–1199px: o painel vira FOLHA, aberta por "Detalhes do cliente";
 * - <768px: uma coisa por vez — a lista, e ao escolher, a conversa com um
 *   "voltar" que desfaz o passo (o mesmo do botão do navegador).
 *
 * As peças de dentro (thread, painel) são simuladas: o que se testa aqui é
 * QUAL delas a página mostra e como a URL anda, não o conteúdo de cada uma.
 */

vi.mock('./ThreadDoCliente', () => ({
  ThreadDoCliente: ({ clienteId, navegacao }: { clienteId: number; navegacao?: NavegacaoDaConversa }) => (
    <section aria-label={`Conversa do cliente ${clienteId}`}>
      {navegacao?.onVoltar && (
        <button type="button" onClick={navegacao.onVoltar}>
          Voltar para a lista de conversas
        </button>
      )}
      {navegacao?.onDetalhes && (
        <button type="button" onClick={navegacao.onDetalhes}>
          Detalhes do cliente
        </button>
      )}
    </section>
  ),
}))

vi.mock('./PainelChat', () => ({
  PainelChat: ({ chatId }: { chatId: number }) => (
    <aside aria-label="Detalhes do atendimento">
      painel {chatId}
      <button type="button">ação qualquer</button>
    </aside>
  ),
}))

vi.mock('./Finalizados', () => ({ Finalizados: () => <p>finalizados</p> }))

vi.mock('@/api/queries/useMe', () => ({ useMe: () => ({ data: { id: 3, is_internal: true } }) }))

function linha(id: number, nome: string): LinhaDeCliente {
  return {
    client_id: id,
    client_name: nome,
    client_avatar: null,
    client_presence: 'available',
    company_name: 'Acme',
    last_activity: '2026-09-08T10:00:00Z',
    last_message_preview: 'oi',
    sessions: 1,
    open_chat_id: id * 10,
    open_agent_id: 3,
    last_chat_id: id * 10,
    unread: 0,
  }
}

const caixa = [linha(1, 'Ana Almeida'), linha(2, 'Bruno Braga')]

vi.mock('@/api/chat', () => ({
  useFilaChat: () => ({ data: [], isLoading: false, isError: false, dataUpdatedAt: 0, refetch: vi.fn() }),
  useMeusChats: () => ({ data: [] }),
  useConfigChat: () => ({ data: { queue_open: true, max_chats_per_agent: 3 } }),
  usePegarChat: () => ({ mutate: vi.fn(), isPending: false }),
  useCaixaDeClientes: () => ({ data: caixa, isLoading: false, isError: false, dataUpdatedAt: 0, refetch: vi.fn() }),
}))

/** Onde a URL está — é ela que guarda o que a tela mostra. */
function Endereco() {
  const { search } = useLocation()
  return <output aria-label="endereço">{search}</output>
}

function montar(largura: 'celular' | 'tablet' | 'desktop', entrada = '/chat') {
  vi.stubGlobal('matchMedia', (consulta: string) => ({
    matches:
      (consulta === '(max-width: 767px)' && largura === 'celular') ||
      (consulta === '(max-width: 1199px)' && largura !== 'desktop'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route
          path="/chat"
          element={
            <>
              <PaginaChat />
              <Endereco />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop largo: três colunas', () => {
  it('abre a primeira conversa e o painel ao lado, sem botão de voltar', () => {
    montar('desktop')
    expect(screen.getByRole('complementary', { name: 'Conversas' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Conversa do cliente 1' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Detalhes do atendimento' })).toHaveTextContent('painel 10')
    expect(screen.queryByRole('button', { name: /Voltar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Detalhes do cliente' })).not.toBeInTheDocument()
  })
})

describe('tablet: o painel vira folha', () => {
  it('só aparece pelo botão, como diálogo, e fecha com Esc', () => {
    montar('tablet')
    expect(screen.queryByRole('complementary', { name: 'Detalhes do atendimento' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Detalhes do cliente' }))
    const folha = screen.getByRole('dialog', { name: 'Detalhes do cliente' })
    expect(folha).toHaveTextContent('painel 10')
    expect(screen.getByLabelText('endereço')).toHaveTextContent('detalhes=1')
    // o foco entra na folha
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fechar detalhes do cliente' }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('endereço')).not.toHaveTextContent('detalhes')
  })
})

describe('celular: uma coisa por vez', () => {
  it('começa na lista, sem pular para uma conversa sozinho', () => {
    montar('celular')
    expect(screen.getByRole('complementary', { name: 'Conversas' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Conversa do cliente/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('endereço')).toHaveTextContent('')
  })

  it('escolher abre a conversa no lugar da lista, e voltar devolve a lista', () => {
    montar('celular')
    fireEvent.click(screen.getByRole('button', { name: /Bruno Braga/ }))

    expect(screen.getByRole('region', { name: 'Conversa do cliente 2' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Conversas' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('endereço')).toHaveTextContent('cliente=2')

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para a lista de conversas' }))
    expect(screen.getByRole('complementary', { name: 'Conversas' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Conversa do cliente/ })).not.toBeInTheDocument()
  })

  it('link direto para uma conversa: voltar leva à lista mesmo sem histórico', () => {
    montar('celular', '/chat?cliente=1')
    expect(screen.getByRole('region', { name: 'Conversa do cliente 1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para a lista de conversas' }))
    expect(screen.getByRole('complementary', { name: 'Conversas' })).toBeInTheDocument()
  })
})
