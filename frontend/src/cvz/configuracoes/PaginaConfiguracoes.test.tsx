import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PaginaConfiguracoes } from './PaginaConfiguracoes'

// Cada seção vira um marcador: o que se testa aqui é a navegação (qual seção
// abre, o que a URL guarda, o que fica montado), não o conteúdo de cada uma —
// esse tem teste próprio (AbaStatus.test.tsx, AbaEquipes.test.tsx...).
function stub(nome: string) {
  return () => <p data-testid={`aba-${nome}`}>conteúdo {nome}</p>
}
vi.mock('./AbaStatus', () => ({ AbaStatus: stub('status') }))
vi.mock('./AbaServicos', () => ({ AbaServicos: stub('servicos') }))
vi.mock('./AbaCategorias', () => ({ AbaCategorias: stub('categorias') }))
vi.mock('./AbaTags', () => ({ AbaTags: stub('tags') }))
vi.mock('./AbaSla', () => ({ AbaSla: stub('sla') }))
vi.mock('./AbaCalendarios', () => ({ AbaCalendarios: stub('calendarios') }))
vi.mock('./AbaEquipes', () => ({ AbaEquipes: stub('equipes') }))
vi.mock('./AbaPapeis', () => ({ AbaPapeis: stub('papeis') }))
vi.mock('./AbaPlanos', () => ({ AbaPlanos: stub('planos') }))
vi.mock('./AbaChat', () => ({ AbaChat: stub('chat') }))
vi.mock('./AbaModeracao', () => ({ AbaModeracao: stub('moderacao') }))
vi.mock('./AbaTelaDeLogin', () => ({ AbaTelaDeLogin: stub('login') }))
vi.mock('./AbaSistema', () => ({ AbaSistema: stub('operacao') }))
vi.mock('./AbaImportar', () => ({ AbaImportar: stub('importar') }))
vi.mock('./AbaBackup', () => ({ AbaBackup: stub('backup') }))

/** A URL atual, escrita na tela: é o que um F5 ou um link copiado levaria. */
function Espiao() {
  return <output data-testid="busca">{useLocation().search}</output>
}
const busca = () => screen.getByTestId('busca').textContent

function montar(rota = '/configuracoes') {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route
          path="/configuracoes"
          element={
            <>
              <PaginaConfiguracoes />
              <Espiao />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

const nav = () => screen.getByRole('navigation', { name: 'Seções de configuração' })
const itemAtivo = () => within(nav()).getAllByRole('link').find((l) => l.getAttribute('aria-current') === 'page')

describe('PaginaConfiguracoes — navegação por seção', () => {
  it('agrupa as quinze seções e abre Status sem parâmetro na URL', () => {
    montar()
    for (const grupo of ['Atendimento', 'Pessoas', 'Canais', 'Sistema']) {
      expect(within(nav()).getByRole('list', { name: grupo })).toBeInTheDocument()
    }
    expect(within(nav()).getAllByRole('link')).toHaveLength(15)
    expect(itemAtivo()).toHaveTextContent('Status')
    expect(screen.getByRole('heading', { level: 2, name: 'Status' })).toBeInTheDocument()
    expect(screen.getByTestId('aba-status')).toBeVisible()
  })

  it('o link antigo com ?aba= continua abrindo a seção certa', () => {
    montar('/configuracoes?aba=backup')
    expect(itemAtivo()).toHaveTextContent('Backup')
    expect(screen.getByRole('region', { name: 'Backup' })).toBeVisible()
    expect(screen.getByTestId('aba-backup')).toBeInTheDocument()
  })

  it('aba desconhecida cai na primeira seção', () => {
    montar('/configuracoes?aba=nao-existe')
    expect(itemAtivo()).toHaveTextContent('Status')
  })

  it('só monta a seção visitada, e mantém montada a que ficou para trás', () => {
    montar()
    expect(screen.queryByTestId('aba-tags')).not.toBeInTheDocument()

    fireEvent.click(within(nav()).getByRole('link', { name: 'Tags' }))
    expect(busca()).toBe('?aba=tags')
    expect(itemAtivo()).toHaveTextContent('Tags')
    expect(screen.getByTestId('aba-tags')).toBeVisible()
    // Status saiu de vista mas não desmontou: um formulário pela metade
    // não se perde só porque a pessoa foi espiar outra seção.
    expect(screen.getByTestId('aba-status')).not.toBeVisible()

    fireEvent.click(within(nav()).getByRole('link', { name: 'Status' }))
    expect(busca()).toBe('')
    expect(screen.getByTestId('aba-status')).toBeVisible()
  })

  it('o seletor de tela estreita leva à mesma seção', () => {
    montar()
    // getByLabelText, não getByRole: fora da largura estreita o seletor está
    // em display:none (o jsdom lê o CSS, mas não avalia a container query).
    const seletor = screen.getByLabelText('Seção de configuração')
    expect(seletor).toHaveValue('status')

    fireEvent.change(seletor, { target: { value: 'moderacao' } })
    expect(busca()).toBe('?aba=moderacao')
    expect(itemAtivo()).toHaveTextContent('Moderação')
    expect(screen.getByTestId('aba-moderacao')).toBeVisible()
  })
})
