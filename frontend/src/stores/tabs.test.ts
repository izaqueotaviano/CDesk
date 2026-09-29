import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTabs } from './tabs'

// O espelho no servidor não entra aqui: reordenar é local e síncrono por
// contrato (docs/06-abas-frontend.md).
vi.mock('@/api/tabs', () => ({
  getTabsServidor: vi.fn(() => new Promise(() => {})),
  putTabsServidor: vi.fn(() => new Promise(() => {})),
}))

function resumo(id: number, ref: string) {
  return {
    id,
    reference: ref,
    subject: `Assunto ${ref}`,
    status: 'open',
    requester_display: 'Beto Barros',
    company_name: `Empresa ${ref}`,
  }
}

afterEach(() => {
  useTabs.setState({ tabs: [], active: null, reconciliando: false })
})

describe('stores/tabs — reordenar', () => {
  it('aplica a nova ordem e manda pro fim o que a lista esqueceu', () => {
    useTabs.setState({
      tabs: [
        { tipo: 'ticket', ticketId: 1, resumo: resumo(1, '#1001'), scroll: 0, draft: '' },
        { tipo: 'secao', rota: '/clientes', titulo: 'Clientes', icone: 'ti ti-users' },
        { tipo: 'ticket', ticketId: 2, resumo: resumo(2, '#1002'), scroll: 0, draft: '' },
      ],
      active: 'ticket:1',
      reconciliando: false,
    })

    useTabs.getState().reordenar(['ticket:2', 'secao:/clientes', 'chave:inventada'])

    expect(useTabs.getState().tabs.map((a) => (a.tipo === 'ticket' ? a.ticketId : a.rota))).toEqual([2, '/clientes', 1])
    expect(useTabs.getState().active).toBe('ticket:1')
  })

  it('reordenar só as chaves de ticket preserva as abas de seção antigas no fim', () => {
    // É o que a lista "Trabalhando agora" faz: ela só conhece tickets, e uma aba de seção
    // herdada de antes (localStorage) não pode sumir por causa disso.
    useTabs.setState({
      tabs: [
        { tipo: 'secao', rota: '/clientes', titulo: 'Clientes', icone: 'ti ti-users' },
        { tipo: 'ticket', ticketId: 1, resumo: resumo(1, '#1001'), scroll: 0, draft: '' },
        { tipo: 'ticket', ticketId: 2, resumo: resumo(2, '#1002'), scroll: 0, draft: '' },
      ],
      active: 'ticket:1',
      reconciliando: false,
    })

    useTabs.getState().reordenar(['ticket:2', 'ticket:1'])

    expect(useTabs.getState().tabs.map((a) => (a.tipo === 'ticket' ? a.ticketId : a.rota))).toEqual([2, 1, '/clientes'])
  })
})
