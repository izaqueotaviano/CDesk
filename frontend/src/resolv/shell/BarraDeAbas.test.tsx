import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useTabs, type Aba } from '@/stores/tabs'
import { BarraDeAbas } from './BarraDeAbas'

// O espelho no servidor é irrelevante aqui: a aba é local e síncrona por
// contrato (docs/06-abas-frontend.md).
vi.mock('@/api/tabs', () => ({
  getTabsServidor: vi.fn(() => new Promise(() => {})),
  putTabsServidor: vi.fn(() => new Promise(() => {})),
}))

const reconciliarOriginal = useTabs.getState().reconciliar
let reconciliar: Mock<() => Promise<void>>

beforeEach(() => {
  reconciliar = vi.fn<() => Promise<void>>(() => Promise.resolve())
  useTabs.setState({ reconciliar })
})

afterEach(() => {
  useTabs.setState({ tabs: [], active: null, reconciliando: false, reconciliar: reconciliarOriginal })
})

function ticket(id: number, extra: { subject?: string; draft?: string; semResumo?: boolean; company?: string } = {}): Aba {
  const ref = `TD-${String(id).padStart(5, '0')}`
  return {
    tipo: 'ticket',
    ticketId: id,
    resumo: extra.semResumo
      ? undefined
      : {
          id,
          reference: ref,
          subject: extra.subject ?? `Assunto ${id}`,
          status: 'open',
          stage_color: '#4c7fb5',
          requester_display: 'Beto Barros',
          company_name: extra.company,
        },
    scroll: 0,
    draft: extra.draft ?? '',
  }
}

function secao(rota: string, titulo: string, icone = 'ti ti-layout-grid'): Aba {
  return { tipo: 'secao', rota, titulo, icone }
}

function Local() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="rota">{pathname}</output>
      <button type="button" onClick={() => navigate('/quadro')}>
        ir para o quadro
      </button>
      <button type="button" onClick={() => navigate('/clientes/3')}>
        ir para o cliente 3
      </button>
    </>
  )
}
const rota = () => screen.getByTestId('rota').textContent

function montar(rotaInicial: string, abas: Aba[] = [], ativa: string | null = null) {
  useTabs.setState({ tabs: abas, active: ativa, reconciliando: false })
  return render(
    <MemoryRouter initialEntries={[rotaInicial]}>
      <BarraDeAbas />
      <Local />
    </MemoryRouter>,
  )
}

const nomesDasAbas = () => screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label'))
const chavesDoStore = () => useTabs.getState().tabs.map((a) => (a.tipo === 'ticket' ? `ticket:${a.ticketId}` : `secao:${a.rota}`))
const aba = (nome: string | RegExp) => screen.getByRole('tab', { name: nome })

describe('BarraDeAbas: Início fixa e abas do store', () => {
  it('a Início é a primeira aba mesmo sem nenhuma outra, e não tem botão de fechar', () => {
    montar('/inicio')

    const abas = screen.getAllByRole('tab')
    expect(abas).toHaveLength(1)
    expect(abas[0]).toHaveAccessibleName('Início')
    expect(abas[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: /Fechar aba Início/ })).not.toBeInTheDocument()
    // fixa: fica fora do store
    expect(useTabs.getState().tabs).toEqual([])
  })

  it('mostra as abas do store na ordem, depois da Início', () => {
    montar('/inicio', [ticket(27), secao('/quadro', 'Quadro'), ticket(2)])

    expect(nomesDasAbas()).toEqual(['Início', 'TD-00027 Assunto 27', 'Quadro', 'TD-00002 Assunto 2'])
  })

  it('aba de ticket: referência discreta + assunto, tooltip com o texto inteiro e a empresa', () => {
    montar('/inicio', [ticket(27, { subject: 'Teclado sem resposta ao pressionar qualquer tecla', company: 'Acme Marketing' })])

    const t = aba(/TD-00027/)
    expect(within(t).getByText('TD-00027')).toHaveClass('barra-de-abas__ref')
    expect(within(t).getByText('Teclado sem resposta ao pressionar qualquer tecla')).toHaveClass('barra-de-abas__titulo')
    expect(t).toHaveAttribute('title', 'TD-00027 · Teclado sem resposta ao pressionar qualquer tecla\nAcme Marketing')
  })

  it('enquanto o resumo não chegou, a aba do ticket diz "Ticket #27"', () => {
    montar('/inicio', [ticket(27, { semResumo: true })])

    const t = aba('Ticket #27')
    expect(t).toHaveAttribute('title', 'Ticket #27')
    expect(screen.getByRole('button', { name: 'Fechar aba Ticket #27' })).toBeInTheDocument()
  })

  it('sem assunto, a referência é o próprio título (não aparece duas vezes)', () => {
    const semAssunto = ticket(27, { subject: 'x' })
    if (semAssunto.tipo === 'ticket' && semAssunto.resumo) semAssunto.resumo.subject = ''
    montar('/inicio', [semAssunto])

    expect(aba('TD-00027').querySelectorAll('.barra-de-abas__ref')).toHaveLength(0)
    expect(within(aba('TD-00027')).getByText('TD-00027')).toHaveClass('barra-de-abas__titulo')
  })

  it('rascunho não enviado vira ponto na aba, no nome acessível e no tooltip', () => {
    montar('/inicio', [ticket(1, { draft: 'já escrevi metade' }), ticket(2, { draft: '  \n ' })])

    expect(aba(/TD-00001/)).toHaveAccessibleName('TD-00001 Assunto 1, rascunho não enviado')
    expect(aba(/TD-00001/).getAttribute('title')).toContain('Rascunho não enviado')
    expect(aba(/TD-00001/).querySelector('.barra-de-abas__rascunho')).not.toBeNull()
    // espaço em branco não conta como rascunho
    expect(aba(/TD-00002/).querySelector('.barra-de-abas__rascunho')).toBeNull()
  })

  it('o botão de fechar é irmão do role="tab", nunca filho dele', () => {
    montar('/inicio', [ticket(1)])

    const t = aba(/TD-00001/)
    const x = screen.getByRole('button', { name: 'Fechar aba TD-00001' })
    expect(t.contains(x)).toBe(false)
    expect(t.parentElement).toBe(x.parentElement)
  })
})

describe('BarraDeAbas: a aba ativa vem da URL', () => {
  it('link direto: a aba do ticket da URL acende no primeiro render, seja qual for o `active` guardado', () => {
    montar('/tickets/5', [ticket(1), ticket(5)], 'ticket:1')

    expect(aba(/TD-00005/)).toHaveAttribute('aria-selected', 'true')
    expect(aba(/TD-00001/)).toHaveAttribute('aria-selected', 'false')
    expect(aba('Início')).toHaveAttribute('aria-selected', 'false')
  })

  it('link direto para uma seção abre a aba dela e a acende', () => {
    montar('/quadro')

    expect(chavesDoStore()).toEqual(['secao:/quadro'])
    expect(useTabs.getState().active).toBe('secao:/quadro')
    expect(aba('Quadro')).toHaveAttribute('aria-selected', 'true')
  })

  it('navegar por fora da barra (sidebar, busca, voltar) abre e acende a aba, sem duplicar', () => {
    montar('/inicio')

    fireEvent.click(screen.getByRole('button', { name: 'ir para o quadro' }))
    expect(aba('Quadro')).toHaveAttribute('aria-selected', 'true')
    expect(aba('Início')).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'ir para o cliente 3' }))
    expect(nomesDasAbas()).toEqual(['Início', 'Quadro', 'Clientes'])

    fireEvent.click(screen.getByRole('button', { name: 'ir para o quadro' }))
    expect(nomesDasAbas()).toEqual(['Início', 'Quadro', 'Clientes'])
    expect(aba('Quadro')).toHaveAttribute('aria-selected', 'true')
    expect(useTabs.getState().active).toBe('secao:/quadro')
  })

  it('/tickets abre a aba da lista, Tickets', () => {
    montar('/tickets')
    expect(nomesDasAbas()).toEqual(['Início', 'Tickets'])
    expect(aba('Tickets')).toHaveAttribute('aria-selected', 'true')
  })

  it('/tickets/novo tem aba própria, distinta da lista Tickets', () => {
    montar('/tickets', [secao('/tickets', 'Tickets')])
    fireEvent.click(screen.getByRole('button', { name: 'Novo ticket' }))

    expect(rota()).toBe('/tickets/novo')
    expect(nomesDasAbas()).toEqual(['Início', 'Tickets', 'Novo ticket'])
    expect(aba('Novo ticket')).toHaveAttribute('aria-selected', 'true')
    expect(aba('Tickets')).toHaveAttribute('aria-selected', 'false')
  })

  it('/tickets/27 pertence à aba de ticket: não cria nem acende a seção Tickets', () => {
    montar('/tickets/27', [ticket(27)])

    expect(nomesDasAbas()).toEqual(['Início', 'TD-00027 Assunto 27'])
    expect(chavesDoStore()).toEqual(['ticket:27'])
    expect(aba(/TD-00027/)).toHaveAttribute('aria-selected', 'true')
  })

  it('/clientes/3 usa a mesma aba Clientes de /clientes', () => {
    montar('/clientes/3')

    expect(nomesDasAbas()).toEqual(['Início', 'Clientes'])
    expect(aba('Clientes')).toHaveAttribute('aria-selected', 'true')
    expect(chavesDoStore()).toEqual(['secao:/clientes'])
  })

  it('/conta abre "Minha conta"', () => {
    montar('/conta')
    expect(nomesDasAbas()).toEqual(['Início', 'Minha conta'])
  })

  it('rota que a barra não conhece não acende nenhuma aba nem cria nenhuma', () => {
    montar('/qualquer/coisa')

    expect(nomesDasAbas()).toEqual(['Início'])
    expect(screen.getByRole('tab', { name: 'Início' })).toHaveAttribute('aria-selected', 'false')
  })

  it('a aba do ticket nasce quando a página carrega os dados, e já nasce acesa (a rota estava lá)', () => {
    montar('/tickets/27')
    expect(nomesDasAbas()).toEqual(['Início'])

    act(() => {
      useTabs.getState().abrirTicket(27, {
        id: 27,
        reference: 'TD-00027',
        subject: 'Teclado sem resposta',
        status: 'open',
        requester_display: 'Ana',
      })
    })

    expect(nomesDasAbas()).toEqual(['Início', 'TD-00027 Teclado sem resposta'])
    expect(aba(/TD-00027/)).toHaveAttribute('aria-selected', 'true')
  })

  it('ao montar, reconcilia com o servidor uma vez, sem esperar', () => {
    montar('/inicio', [ticket(1)])

    expect(reconciliar).toHaveBeenCalledTimes(1)
    // o que já estava guardado aparece na hora
    expect(aba(/TD-00001/)).toBeInTheDocument()
  })

  it('aba de seção herdada de uma rota que não existe mais é descartada ao montar', () => {
    montar('/inicio', [secao('/calendario', 'Calendário'), ticket(1)])

    expect(chavesDoStore()).toEqual(['ticket:1'])
    expect(nomesDasAbas()).toEqual(['Início', 'TD-00001 Assunto 1'])
  })
})

describe('BarraDeAbas: ativar', () => {
  it('clicar numa aba ativa e navega', () => {
    montar('/inicio', [ticket(27), secao('/quadro', 'Quadro')])

    fireEvent.click(aba(/TD-00027/))
    expect(rota()).toBe('/tickets/27')
    expect(useTabs.getState().active).toBe('ticket:27')

    fireEvent.click(aba('Quadro'))
    expect(rota()).toBe('/quadro')
    expect(useTabs.getState().active).toBe('secao:/quadro')

    fireEvent.click(aba('Início'))
    expect(rota()).toBe('/inicio')
  })

  it('clicar na aba em que já está não navega (não tira a pessoa de /clientes/3)', () => {
    montar('/clientes/3')

    fireEvent.click(aba('Clientes'))

    expect(rota()).toBe('/clientes/3')
  })

  it('o "+" depois das abas abre a tela de novo ticket', () => {
    montar('/inicio', [ticket(1)])

    const novo = screen.getByRole('button', { name: 'Novo ticket' })
    expect(novo).toHaveAttribute('title', 'Novo ticket')
    // fora do tablist: é uma ação, não uma aba
    expect(screen.getByRole('tablist').contains(novo)).toBe(false)
    fireEvent.click(novo)

    expect(rota()).toBe('/tickets/novo')
  })
})

describe('BarraDeAbas: fechar', () => {
  it('fechar a aba ativa navega para a da direita', () => {
    montar('/tickets/2', [ticket(1), ticket(2), ticket(3)], 'ticket:2')

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba TD-00002' }))

    expect(chavesDoStore()).toEqual(['ticket:1', 'ticket:3'])
    expect(rota()).toBe('/tickets/3')
    expect(aba(/TD-00003/)).toHaveAttribute('aria-selected', 'true')
  })

  it('se a ativa era a última, navega para a da esquerda', () => {
    montar('/tickets/3', [ticket(1), ticket(2), ticket(3)], 'ticket:3')

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba TD-00003' }))

    expect(rota()).toBe('/tickets/2')
    expect(useTabs.getState().active).toBe('ticket:2')
  })

  it('a vizinha pode ser uma seção: vai para a rota dela', () => {
    montar('/tickets/2', [secao('/quadro', 'Quadro'), ticket(2)], 'ticket:2')

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba TD-00002' }))

    expect(rota()).toBe('/quadro')
    expect(aba('Quadro')).toHaveAttribute('aria-selected', 'true')
  })

  it('sem nenhuma outra, cai no Início', () => {
    montar('/tickets/1', [ticket(1)], 'ticket:1')

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba TD-00001' }))

    expect(chavesDoStore()).toEqual([])
    expect(rota()).toBe('/inicio')
    expect(aba('Início')).toHaveAttribute('aria-selected', 'true')
  })

  it('se a ativa era a primeira e a única depois da Início, também volta ao Início', () => {
    montar('/quadro', [secao('/quadro', 'Quadro')], 'secao:/quadro')

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba Quadro' }))

    expect(rota()).toBe('/inicio')
  })

  it('fechar uma aba inativa não navega', () => {
    montar('/tickets/1', [ticket(1), ticket(2)], 'ticket:1')

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba TD-00002' }))

    expect(chavesDoStore()).toEqual(['ticket:1'])
    expect(rota()).toBe('/tickets/1')
    expect(aba(/TD-00001/)).toHaveAttribute('aria-selected', 'true')
  })

  it('clique do meio fecha, como no navegador (e não na Início)', () => {
    montar('/tickets/1', [ticket(1), ticket(2)], 'ticket:1')

    // a testing-library não tem atalho pra `auxclick`: é o evento nativo do botão do meio
    fireEvent(aba(/TD-00002/), new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))
    expect(chavesDoStore()).toEqual(['ticket:1'])
    expect(rota()).toBe('/tickets/1')

    fireEvent(aba('Início'), new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))
    expect(chavesDoStore()).toEqual(['ticket:1'])
  })

  it('Delete e Backspace com a aba focada fecham; na Início não fazem nada', () => {
    montar('/tickets/1', [ticket(1), ticket(2), ticket(3)], 'ticket:1')

    fireEvent.keyDown(aba(/TD-00002/), { key: 'Delete' })
    expect(chavesDoStore()).toEqual(['ticket:1', 'ticket:3'])

    fireEvent.keyDown(aba(/TD-00003/), { key: 'Backspace' })
    expect(chavesDoStore()).toEqual(['ticket:1'])

    fireEvent.keyDown(aba('Início'), { key: 'Delete' })
    expect(chavesDoStore()).toEqual(['ticket:1'])
    expect(rota()).toBe('/tickets/1')
  })

  it('Delete na aba focada e ativa fecha, navega e leva o foco para a vizinha', () => {
    montar('/tickets/2', [ticket(1), ticket(2), ticket(3)], 'ticket:2')
    aba(/TD-00002/).focus()

    fireEvent.keyDown(aba(/TD-00002/), { key: 'Delete' })

    expect(rota()).toBe('/tickets/3')
    expect(aba(/TD-00003/)).toHaveFocus()
  })

  it('fechar uma seção não chama o servidor (só ticket é espelhado)', async () => {
    const { putTabsServidor } = await import('@/api/tabs')
    vi.useFakeTimers()
    try {
      montar('/quadro', [secao('/quadro', 'Quadro'), secao('/notas', 'Notas')], 'secao:/quadro')
      fireEvent.click(screen.getByRole('button', { name: 'Fechar aba Notas' }))
      vi.advanceTimersByTime(5000)
      expect(putTabsServidor).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('BarraDeAbas: menu de contexto', () => {
  const tres = () => montar('/tickets/2', [ticket(1), ticket(2), ticket(3)], 'ticket:2')
  const abrirMenu = (nome: string | RegExp) => {
    fireEvent.contextMenu(aba(nome))
    return screen.getByRole('menu', { name: 'Ações da aba' })
  }
  const escolher = (nome: string) => fireEvent.click(screen.getByRole('menuitem', { name: nome }))

  it('tem as cinco ações, na ordem', () => {
    tres()
    const menu = abrirMenu(/TD-00002/)

    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Fechar',
      'Fechar as outras',
      'Fechar as da direita',
      'Fechar as da esquerda',
      'Fechar todas',
    ])
  })

  it('"Fechar" fecha a aba do clique; sendo a ativa, navega para a vizinha', () => {
    tres()
    abrirMenu(/TD-00002/)
    escolher('Fechar')

    expect(chavesDoStore()).toEqual(['ticket:1', 'ticket:3'])
    expect(rota()).toBe('/tickets/3')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('"Fechar as outras" deixa só a escolhida e vai para ela quando a ativa se foi', () => {
    montar('/tickets/1', [ticket(1), ticket(2), ticket(3)], 'ticket:1')
    abrirMenu(/TD-00003/)
    escolher('Fechar as outras')

    expect(chavesDoStore()).toEqual(['ticket:3'])
    expect(rota()).toBe('/tickets/3')
  })

  it('"Fechar as outras" com a escolhida ativa não navega', () => {
    tres()
    abrirMenu(/TD-00002/)
    escolher('Fechar as outras')

    expect(chavesDoStore()).toEqual(['ticket:2'])
    expect(rota()).toBe('/tickets/2')
  })

  it('"Fechar as da direita" e "as da esquerda" respeitam a posição; a Início nunca conta', () => {
    montar('/tickets/2', [ticket(1), ticket(2), ticket(3)], 'ticket:2')
    abrirMenu(/TD-00002/)
    escolher('Fechar as da direita')
    expect(chavesDoStore()).toEqual(['ticket:1', 'ticket:2'])

    abrirMenu(/TD-00002/)
    escolher('Fechar as da esquerda')
    expect(chavesDoStore()).toEqual(['ticket:2'])

    // só sobrou ela: nada à esquerda (a Início não fecha), nada à direita
    const menu = abrirMenu(/TD-00002/)
    expect(within(menu).getByRole('menuitem', { name: 'Fechar as da esquerda' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Fechar as da direita' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Fechar as outras' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Fechar' })).toBeEnabled()
  })

  it('fechar as da direita com a ativa entre elas navega para a escolhida', () => {
    montar('/tickets/3', [ticket(1), ticket(2), ticket(3)], 'ticket:3')
    abrirMenu(/TD-00001/)
    escolher('Fechar as da direita')

    expect(chavesDoStore()).toEqual(['ticket:1'])
    expect(rota()).toBe('/tickets/1')
  })

  it('"Fechar todas" esvazia o store e volta ao Início', () => {
    montar('/tickets/2', [ticket(1), secao('/quadro', 'Quadro'), ticket(2)], 'ticket:2')
    abrirMenu(/TD-00001/)
    escolher('Fechar todas')

    expect(chavesDoStore()).toEqual([])
    expect(rota()).toBe('/inicio')
    expect(nomesDasAbas()).toEqual(['Início'])
  })

  it('na Início: só "Fechar todas" e "Fechar as outras" (e as da direita) valem', () => {
    montar('/inicio', [ticket(1)])
    const menu = abrirMenu('Início')

    expect(within(menu).getByRole('menuitem', { name: 'Fechar' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Fechar as da esquerda' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Fechar as da direita' })).toBeEnabled()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Fechar todas' }))
    expect(chavesDoStore()).toEqual([])
    expect(rota()).toBe('/inicio')
  })

  it('fechar pelo menu leva o foco para uma aba que continua aberta', () => {
    montar('/tickets/1', [ticket(1), ticket(2)], 'ticket:1')
    abrirMenu(/TD-00002/)
    escolher('Fechar')

    expect(aba(/TD-00001/)).toHaveFocus()
  })
})

describe('BarraDeAbas: teclado (padrão WAI-ARIA de tabs)', () => {
  it('só a aba ativa entra na ordem de tabulação (tabIndex 0); as outras ficam -1', () => {
    montar('/tickets/2', [ticket(1), ticket(2), ticket(3)], 'ticket:2')

    const abas = screen.getAllByRole('tab')
    expect(abas.map((a) => a.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1'])
    expect(abas[2]).toHaveAttribute('aria-selected', 'true')
  })

  it('sem nenhuma aba ativa, a Início recebe o Tab', () => {
    montar('/qualquer/coisa', [ticket(1)])

    expect(screen.getAllByRole('tab').map((a) => a.getAttribute('tabindex'))).toEqual(['0', '-1'])
  })

  it('seta direita move o FOCO para a próxima aba, sem ativar nem navegar', () => {
    montar('/tickets/1', [ticket(1), ticket(2)], 'ticket:1')

    const [, um, dois] = screen.getAllByRole('tab')
    um!.focus()
    fireEvent.keyDown(um!, { key: 'ArrowRight' })

    expect(dois).toHaveFocus()
    expect(dois).toHaveAttribute('tabindex', '0')
    expect(um).toHaveAttribute('tabindex', '-1')
    expect(useTabs.getState().active).toBe('ticket:1')
    expect(rota()).toBe('/tickets/1')
  })

  it('setas dão a volta: esquerda na Início vai para a última; direita na última vai para a Início', () => {
    montar('/inicio', [ticket(1), ticket(2), ticket(3)])

    const abas = screen.getAllByRole('tab')
    abas[0]!.focus()
    fireEvent.keyDown(abas[0]!, { key: 'ArrowLeft' })
    expect(abas[3]).toHaveFocus()

    fireEvent.keyDown(abas[3]!, { key: 'ArrowRight' })
    expect(abas[0]).toHaveFocus()
  })

  it('Home vai para a primeira aba e End para a última', () => {
    montar('/tickets/2', [ticket(1), ticket(2), ticket(3)], 'ticket:2')

    const abas = screen.getAllByRole('tab')
    abas[2]!.focus()
    fireEvent.keyDown(abas[2]!, { key: 'End' })
    expect(abas[3]).toHaveFocus()

    fireEvent.keyDown(abas[3]!, { key: 'Home' })
    expect(abas[0]).toHaveFocus()
    expect(abas[0]).toHaveAttribute('tabindex', '0')
  })

  it('Enter ativa a aba focada (o botão nativo dispara o clique)', () => {
    montar('/inicio', [ticket(1)])
    const t = aba(/TD-00001/)
    t.focus()
    // O clique nativo do Enter/Espaço em <button> não é simulado pelo jsdom.
    fireEvent.click(t)

    expect(rota()).toBe('/tickets/1')
  })
})
