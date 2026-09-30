import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTabsServidor, putTabsServidor } from '@/api/tabs'
import { chaveDeSecao, chaveDeTicket, migrarAbasPersistidas, useTabs, type Aba } from './tabs'

// O espelho no servidor é simulado: a aba é local e síncrona por contrato
// (docs/06-abas-frontend.md), e o que interessa aqui é QUANDO o servidor é
// chamado e o que a resposta dele faz com a lista.
vi.mock('@/api/tabs', () => ({
  getTabsServidor: vi.fn(),
  putTabsServidor: vi.fn(),
}))
const getMock = vi.mocked(getTabsServidor)
const putMock = vi.mocked(putTabsServidor)

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

const tk = (id: number, draft = ''): Aba => ({ tipo: 'ticket', ticketId: id, resumo: resumo(id, `#${1000 + id}`), scroll: 0, draft })
const sec = (rota: string, titulo = rota): Aba => ({ tipo: 'secao', rota, titulo, icone: 'ti ti-users' })
const ordem = () => useTabs.getState().tabs.map((a) => (a.tipo === 'ticket' ? a.ticketId : a.rota))

beforeEach(() => {
  vi.useFakeTimers()
  // Estado limpo e "já reconciliado": o espelho só recebe PUT depois da primeira
  // leitura (os testes que tratam disso desligam a flag de propósito).
  useTabs.setState({ tabs: [], active: null, reconciliando: false, rascunhosGuardados: [] })
  getMock.mockReset()
  putMock.mockReset()
  // O servidor aceita o que recebe (todos os tickets visíveis) e devolve igual.
  putMock.mockImplementation(async (dados) => ({
    tabs: dados.ticket_ids.map((id) => resumo(id, `#${1000 + id}`)),
    active_ticket_id: dados.active_ticket_id,
  }))
})

afterEach(() => {
  vi.useRealTimers()
  useTabs.getState().limparTudo()
  useTabs.setState({ reconciliando: false })
})

function definir(tabs: Aba[], active: string | null = null) {
  useTabs.setState({ tabs, active, reconciliando: false })
}

/** Deixa o debounce de 2s do espelho vencer. */
async function passarDoDebounce() {
  await vi.advanceTimersByTimeAsync(2500)
}

describe('stores/tabs: chaves', () => {
  it('a chave de ticket e a de seção saem de um lugar só e batem com a chave da aba', () => {
    expect(chaveDeTicket(27)).toBe('ticket:27')
    expect(chaveDeSecao('/quadro')).toBe('secao:/quadro')
    definir([tk(27), sec('/quadro')])
    useTabs.getState().definirAtiva(chaveDeTicket(27))
    expect(useTabs.getState().active).toBe('ticket:27')
  })
})

describe('stores/tabs: reordenar', () => {
  it('aplica a nova ordem e manda pro fim o que a lista esqueceu', () => {
    definir([tk(1), sec('/clientes'), tk(2)], 'ticket:1')

    useTabs.getState().reordenar(['ticket:2', 'secao:/clientes', 'chave:inventada'])

    expect(ordem()).toEqual([2, '/clientes', 1])
    expect(useTabs.getState().active).toBe('ticket:1')
  })

  it('reordenar só as chaves de ticket não perde as abas de seção: vão para o fim', () => {
    definir([sec('/clientes'), tk(1), tk(2)], 'ticket:1')

    useTabs.getState().reordenar(['ticket:2', 'ticket:1'])

    expect(ordem()).toEqual([2, 1, '/clientes'])
  })
})

describe('stores/tabs: seções são locais, ticket é espelhado', () => {
  it('abrirSecao cria a aba, reabrir a mesma rota não duplica e só ativa', () => {
    const { abrirSecao } = useTabs.getState()
    abrirSecao('/quadro', 'Quadro', 'ti ti-layout-grid')
    abrirSecao('/clientes', 'Clientes', 'ti ti-users')
    abrirSecao('/quadro', 'Quadro', 'ti ti-layout-grid')

    expect(ordem()).toEqual(['/quadro', '/clientes'])
    expect(useTabs.getState().active).toBe('secao:/quadro')
  })

  it('abrir, ativar, fechar e reordenar seções nunca chega ao servidor', async () => {
    const s = useTabs.getState()
    s.abrirSecao('/quadro', 'Quadro', 'ti ti-layout-grid')
    s.abrirSecao('/clientes', 'Clientes', 'ti ti-users')
    s.abrirSecao('/notas', 'Notas', 'ti ti-note')
    s.definirAtiva('secao:/clientes')
    s.reordenar(['secao:/notas', 'secao:/quadro', 'secao:/clientes'])
    s.fechar('secao:/notas')
    s.fecharVarias(['secao:/quadro', 'secao:/clientes'])
    await passarDoDebounce()

    expect(putMock).not.toHaveBeenCalled()
    expect(useTabs.getState().tabs).toEqual([])
  })

  it('mexer nos tickets (abrir, ativar, fechar, mudar a ordem deles) manda ao servidor, com debounce', async () => {
    const s = useTabs.getState()
    s.abrirTicket(1, resumo(1, '#1001'))
    s.abrirTicket(2, resumo(2, '#1002'))
    await passarDoDebounce()
    expect(putMock).toHaveBeenLastCalledWith({ ticket_ids: [1, 2], active_ticket_id: 2 })

    s.definirAtiva('ticket:1')
    await passarDoDebounce()
    expect(putMock).toHaveBeenLastCalledWith({ ticket_ids: [1, 2], active_ticket_id: 1 })

    s.reordenar(['ticket:2', 'ticket:1'])
    await passarDoDebounce()
    expect(putMock).toHaveBeenLastCalledWith({ ticket_ids: [2, 1], active_ticket_id: 1 })

    s.fechar('ticket:2')
    await passarDoDebounce()
    expect(putMock).toHaveBeenLastCalledWith({ ticket_ids: [1], active_ticket_id: 1 })
    expect(putMock).toHaveBeenCalledTimes(4)
  })

  it('a lista que vai ao servidor só tem tickets, mesmo com seções no meio', async () => {
    definir([sec('/quadro'), tk(1), sec('/clientes'), tk(2)], 'ticket:2')

    useTabs.getState().fechar('ticket:1')
    await passarDoDebounce()

    expect(putMock).toHaveBeenCalledWith({ ticket_ids: [2], active_ticket_id: 2 })
  })

  it('arrastar uma seção de lugar não muda a ordem dos tickets e não vai ao servidor', async () => {
    definir([tk(1), sec('/quadro'), tk(2)], 'ticket:1')

    useTabs.getState().reordenar(['secao:/quadro', 'ticket:1', 'ticket:2'])
    await passarDoDebounce()

    expect(putMock).not.toHaveBeenCalled()
    expect(ordem()).toEqual(['/quadro', 1, 2])
  })

  it('fechar a ativa aponta para a última que sobrou; fecharVarias também', () => {
    definir([tk(1), sec('/quadro'), tk(2)], 'ticket:2')
    useTabs.getState().fechar('ticket:2')
    expect(useTabs.getState().active).toBe('secao:/quadro')

    definir([tk(1), tk(2), tk(3)], 'ticket:3')
    useTabs.getState().fecharVarias(['ticket:3', 'ticket:2'])
    expect(useTabs.getState().active).toBe('ticket:1')

    useTabs.getState().fecharVarias(['ticket:1'])
    expect(useTabs.getState().active).toBeNull()
  })

  it('fechar uma chave que não existe é inofensivo', async () => {
    definir([tk(1)], 'ticket:1')
    useTabs.getState().fechar('ticket:99')
    await passarDoDebounce()

    expect(ordem()).toEqual([1])
    expect(putMock).not.toHaveBeenCalled()
  })
})

describe('stores/tabs: reconciliar', () => {
  it('a resposta do servidor não reembaralha: cada seção fica onde estava, tickets na ordem dele', async () => {
    definir([tk(3), sec('/quadro'), tk(1), sec('/clientes'), tk(2)], 'secao:/quadro')
    getMock.mockResolvedValue({ tabs: [resumo(3, '#1003'), resumo(1, '#1001'), resumo(2, '#1002')], active_ticket_id: 2 })

    await useTabs.getState().reconciliar()

    expect(ordem()).toEqual([3, '/quadro', 1, '/clientes', 2])
    // quem manda no que está ativo é a tela em que a pessoa está
    expect(useTabs.getState().active).toBe('secao:/quadro')
    expect(useTabs.getState().reconciliando).toBe(false)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('ticket aberto em outro aparelho entra no fim, e a seção não se mexe', async () => {
    definir([tk(1), sec('/quadro'), tk(2)], 'ticket:1')
    getMock.mockResolvedValue({ tabs: [resumo(1, '#1001'), resumo(2, '#1002'), resumo(7, '#1007')], active_ticket_id: 7 })

    await useTabs.getState().reconciliar()

    expect(ordem()).toEqual([1, '/quadro', 2, 7])
    expect(useTabs.getState().active).toBe('ticket:1')
  })

  it('ticket que perdeu acesso some sem deixar buraco entre as seções', async () => {
    definir([tk(1), sec('/quadro'), tk(2)], 'ticket:1')
    getMock.mockResolvedValue({ tabs: [resumo(1, '#1001')], active_ticket_id: 1 })
    putMock.mockResolvedValue({ tabs: [resumo(1, '#1001')], active_ticket_id: 1 })

    await useTabs.getState().reconciliar()

    expect(ordem()).toEqual([1, '/quadro'])
  })

  it('ticket só local vai ao servidor na união, e a resposta do PUT vira a verdade', async () => {
    definir([tk(1, 'rascunho meu'), sec('/quadro'), tk(2)], 'ticket:2')
    getMock.mockResolvedValue({ tabs: [resumo(1, '#1001')], active_ticket_id: 1 })
    putMock.mockResolvedValue({ tabs: [resumo(1, '#1001'), resumo(2, '#1002')], active_ticket_id: 2 })

    await useTabs.getState().reconciliar()

    expect(putMock).toHaveBeenCalledWith({ ticket_ids: [1, 2], active_ticket_id: 2 })
    expect(ordem()).toEqual([1, '/quadro', 2])
    const primeira = useTabs.getState().tabs[0]
    // rascunho e scroll são só locais: sobrevivem à resposta
    expect(primeira?.tipo === 'ticket' && primeira.draft).toBe('rascunho meu')
  })

  it('o ticket aberto enquanto o PUT da reconciliação está em voo não some com a resposta', async () => {
    // Recarregar dentro de um ticket com abas só locais: a barra reconcilia e,
    // no meio do PUT, a página do ticket abre a aba dele.
    definir([tk(27)], 'ticket:27')
    getMock.mockResolvedValue({ tabs: [], active_ticket_id: null })
    let responder!: (r: { tabs: ReturnType<typeof resumo>[]; active_ticket_id: number | null }) => void
    putMock.mockReturnValueOnce(new Promise((resolve) => (responder = resolve)))

    const pronta = useTabs.getState().reconciliar()
    await vi.advanceTimersByTimeAsync(0)
    expect(putMock).toHaveBeenCalledWith({ ticket_ids: [27], active_ticket_id: 27 })

    useTabs.getState().abrirTicket(2, resumo(2, '#1002'))
    responder({ tabs: [resumo(27, '#1027')], active_ticket_id: 27 })
    await pronta

    expect(ordem()).toEqual([27, 2])
    expect(useTabs.getState().active).toBe('ticket:2')
  })

  it('o ticket fechado enquanto o PUT está em voo não ressuscita com a resposta', async () => {
    definir([tk(27), tk(5)], 'ticket:27')
    getMock.mockResolvedValue({ tabs: [], active_ticket_id: null })
    let responder!: (r: { tabs: ReturnType<typeof resumo>[]; active_ticket_id: number | null }) => void
    putMock.mockReturnValueOnce(new Promise((resolve) => (responder = resolve)))

    const pronta = useTabs.getState().reconciliar()
    await vi.advanceTimersByTimeAsync(0)
    useTabs.getState().fechar('ticket:5')
    responder({ tabs: [resumo(27, '#1027'), resumo(5, '#1005')], active_ticket_id: 27 })
    await pronta

    expect(ordem()).toEqual([27])
  })

  it('ticket só local + tickets que só o servidor conhece: nenhum dos do servidor some da barra', async () => {
    // Dois aparelhos: este ainda tem o 8, que o outro já fechou, e o servidor
    // tem o 2 e o 5, abertos no outro. A união vai ao servidor, e os do
    // servidor não foram "fechados aqui" só por não estarem aqui.
    definir([tk(8)], 'ticket:8')
    getMock.mockResolvedValue({ tabs: [resumo(2, '#1002'), resumo(5, '#1005')], active_ticket_id: 5 })
    putMock.mockResolvedValue({
      tabs: [resumo(2, '#1002'), resumo(5, '#1005'), resumo(8, '#1008')],
      active_ticket_id: 8,
    })

    await useTabs.getState().reconciliar()

    expect(putMock).toHaveBeenCalledWith({ ticket_ids: [2, 5, 8], active_ticket_id: 8 })
    expect(ordem()).toEqual([2, 5, 8])
    expect(useTabs.getState().active).toBe('ticket:8')
  })

  it('o fechado durante o PUT da união segue fechado, e os do servidor entram', async () => {
    definir([tk(8), tk(9)], 'ticket:8')
    getMock.mockResolvedValue({ tabs: [resumo(2, '#1002')], active_ticket_id: 2 })
    let responder!: (r: { tabs: ReturnType<typeof resumo>[]; active_ticket_id: number | null }) => void
    putMock.mockReturnValueOnce(new Promise((resolve) => (responder = resolve)))

    const pronta = useTabs.getState().reconciliar()
    await vi.advanceTimersByTimeAsync(0)
    useTabs.getState().fechar('ticket:9')
    responder({ tabs: [resumo(2, '#1002'), resumo(8, '#1008'), resumo(9, '#1009')], active_ticket_id: 8 })
    await pronta

    expect(ordem()).toEqual([2, 8])
  })

  it('aba que só o servidor conhece volta com o rascunho guardado do ticket', async () => {
    definir([], null)
    useTabs.setState({ rascunhosGuardados: [{ ticketId: 5, draft: 'meu rascunho' }, { ticketId: 9, draft: 'outro' }] })
    getMock.mockResolvedValue({ tabs: [resumo(5, '#1005')], active_ticket_id: 5 })

    await useTabs.getState().reconciliar()

    const aba = useTabs.getState().tabs[0]
    expect(aba?.tipo === 'ticket' && aba.draft).toBe('meu rascunho')
    // só o restaurado sai da lista de guardados
    expect(useTabs.getState().rascunhosGuardados).toEqual([{ ticketId: 9, draft: 'outro' }])
  })

  it('aparelho novo, sem nada local: a lista e o ativo vêm do servidor', async () => {
    definir([], null)
    getMock.mockResolvedValue({ tabs: [resumo(5, '#1005'), resumo(6, '#1006')], active_ticket_id: 6 })

    await useTabs.getState().reconciliar()

    expect(ordem()).toEqual([5, 6])
    expect(useTabs.getState().active).toBe('ticket:6')
  })

  it('duas chamadas seguidas dividem a mesma requisição', async () => {
    getMock.mockResolvedValue({ tabs: [], active_ticket_id: null })

    await Promise.all([useTabs.getState().reconciliar(), useTabs.getState().reconciliar()])

    expect(getMock).toHaveBeenCalledTimes(1)
  })
})

describe('stores/tabs: localStorage de versões anteriores', () => {
  it('v1: abas de ticket sem `tipo` e `active` numérico viram o formato atual', () => {
    const r = migrarAbasPersistidas({ tabs: [{ ticketId: 4, scroll: 10, draft: 'oi' }, { ticketId: 9 }], active: 9 })

    expect(r.tabs).toEqual([
      { tipo: 'ticket', ticketId: 4, resumo: undefined, scroll: 10, draft: 'oi' },
      { tipo: 'ticket', ticketId: 9, resumo: undefined, scroll: 0, draft: '' },
    ])
    expect(r.active).toBe('ticket:9')
  })

  it('v2: as abas de seção guardadas antes são preservadas, na ordem', () => {
    const r = migrarAbasPersistidas({
      tabs: [
        { tipo: 'secao', rota: '/clientes', titulo: 'Clientes', icone: 'ti ti-users' },
        { tipo: 'ticket', ticketId: 3, scroll: 0, draft: '' },
      ],
      active: 'secao:/clientes',
    })

    expect(r.tabs.map((a) => (a.tipo === 'ticket' ? a.ticketId : a.rota))).toEqual(['/clientes', 3])
    expect(r.active).toBe('secao:/clientes')
  })

  it('a rota que se chamava /chamados vira /tickets, sem duplicar', () => {
    const r = migrarAbasPersistidas({
      tabs: [
        { tipo: 'secao', rota: '/chamados', titulo: 'Tickets', icone: 'ti ti-ticket' },
        { tipo: 'secao', rota: '/tickets', titulo: 'Tickets', icone: 'ti ti-ticket' },
        { tipo: 'secao', rota: '/chamados/novo', titulo: 'Novo', icone: 'ti ti-plus' },
      ],
      active: 'secao:/chamados',
    })

    expect(r.tabs.map((a) => (a.tipo === 'secao' ? a.rota : null))).toEqual(['/tickets', '/tickets/novo'])
    expect(r.active).toBe('secao:/tickets')
  })

  it('lixo é descartado em vez de derrubar o console', () => {
    expect(migrarAbasPersistidas(undefined)).toEqual({ tabs: [], active: null })
    expect(migrarAbasPersistidas({ tabs: 'x' })).toEqual({ tabs: [], active: null })
    const r = migrarAbasPersistidas({ tabs: [null, 3, { tipo: 'secao' }, { ticketId: 'x' }, { ticketId: 2 }, { ticketId: 2 }], active: 'ticket:99' })
    expect(r.tabs.map((a) => (a.tipo === 'ticket' ? a.ticketId : a.rota))).toEqual([2])
    // ativa que não existe mais não fica apontando para o nada
    expect(r.active).toBeNull()
  })
})

describe('stores/tabs: rascunho de aba fechada', () => {
  it('fechar guarda o texto; reabrir o ticket o devolve à aba nova e tira da lista', () => {
    definir([tk(1, 'resposta começada'), tk(2)], 'ticket:2')

    useTabs.getState().fechar('ticket:1')
    expect(useTabs.getState().rascunhosGuardados).toEqual([{ ticketId: 1, draft: 'resposta começada' }])

    useTabs.getState().abrirTicket(1, resumo(1, '#1001'))
    const reaberta = useTabs.getState().tabs.find((a) => a.tipo === 'ticket' && a.ticketId === 1)
    expect(reaberta?.tipo === 'ticket' && reaberta.draft).toBe('resposta começada')
    expect(useTabs.getState().rascunhosGuardados).toEqual([])
  })

  it('fecharVarias guarda os de todas; vazio e só espaço não contam; seção não tem rascunho', () => {
    definir([tk(1, 'um'), tk(2, '   '), tk(3), sec('/quadro'), tk(4, 'quatro')], 'ticket:1')

    useTabs.getState().fecharVarias(['ticket:1', 'ticket:2', 'ticket:3', 'secao:/quadro', 'ticket:4'])

    expect(useTabs.getState().rascunhosGuardados).toEqual([
      { ticketId: 1, draft: 'um' },
      { ticketId: 4, draft: 'quatro' },
    ])
  })

  it('fechar de novo o mesmo ticket troca o rascunho (não duplica), e a lista tem limite', () => {
    definir([tk(1, 'velho')])
    useTabs.getState().fechar('ticket:1')
    definir([tk(1, 'novo')])
    useTabs.getState().fechar('ticket:1')
    expect(useTabs.getState().rascunhosGuardados).toEqual([{ ticketId: 1, draft: 'novo' }])

    definir(Array.from({ length: 40 }, (_, i) => tk(100 + i, `texto ${i}`)))
    useTabs.getState().fecharVarias(useTabs.getState().tabs.map((a) => (a.tipo === 'ticket' ? chaveDeTicket(a.ticketId) : '')))
    const guardados = useTabs.getState().rascunhosGuardados
    expect(guardados).toHaveLength(30)
    // ficam os mais recentes
    expect(guardados[guardados.length - 1]).toEqual({ ticketId: 139, draft: 'texto 39' })
  })

  it('reabrir um ticket sem rascunho guardado não inventa texto', () => {
    useTabs.getState().abrirTicket(7, resumo(7, '#1007'))
    const aba = useTabs.getState().tabs[0]
    expect(aba?.tipo === 'ticket' && aba.draft).toBe('')
  })
})

describe('stores/tabs: atualizarResumo', () => {
  it('troca o resumo de uma aba aberta, sem ativar nem chamar o servidor', async () => {
    definir([tk(1), tk(2)], 'ticket:2')

    useTabs.getState().atualizarResumo(1, { ...resumo(1, '#1001'), stage_color: '#ff0000', status: 'pending' })
    await passarDoDebounce()

    const aba = useTabs.getState().tabs[0]
    expect(aba?.tipo === 'ticket' && aba.resumo?.stage_color).toBe('#ff0000')
    expect(aba?.tipo === 'ticket' && aba.resumo?.status).toBe('pending')
    expect(useTabs.getState().active).toBe('ticket:2')
    expect(putMock).not.toHaveBeenCalled()
  })

  it('resumo igual não mexe no estado; ticket sem aba é ignorado', () => {
    definir([tk(1)])
    const antes = useTabs.getState().tabs

    useTabs.getState().atualizarResumo(1, resumo(1, '#1001'))
    useTabs.getState().atualizarResumo(99, resumo(99, '#1099'))

    expect(useTabs.getState().tabs).toBe(antes)
  })
})

describe('stores/tabs: espelho só depois da primeira leitura', () => {
  it('com a reconciliação ainda pendente, o PUT espera a leitura e vai como união (nunca só o que há aqui)', async () => {
    useTabs.setState({ reconciliando: true })
    getMock.mockResolvedValue({ tabs: [resumo(2, '#1002')], active_ticket_id: 2 })
    putMock.mockImplementation(async (dados) => ({
      tabs: dados.ticket_ids.map((id) => resumo(id, `#${1000 + id}`)),
      active_ticket_id: dados.active_ticket_id,
    }))

    useTabs.getState().abrirTicket(8, resumo(8, '#1008'))
    await passarDoDebounce()

    // o primeiro PUT já leva o ticket do servidor junto
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(putMock.mock.calls[0]![0].ticket_ids).toEqual([2, 8])
    expect(ordem()).toEqual([2, 8])
    expect(useTabs.getState().reconciliando).toBe(false)
  })

  it('se a leitura falha, nada é enviado (não apaga o que outro aparelho abriu) e a próxima mudança tenta de novo', async () => {
    useTabs.setState({ reconciliando: true })
    getMock.mockRejectedValueOnce(new Error('500'))

    useTabs.getState().abrirTicket(8, resumo(8, '#1008'))
    await passarDoDebounce()
    expect(putMock).not.toHaveBeenCalled()
    expect(useTabs.getState().reconciliando).toBe(true)

    getMock.mockResolvedValue({ tabs: [], active_ticket_id: null })
    useTabs.getState().abrirTicket(9, resumo(9, '#1009'))
    await passarDoDebounce()
    expect(putMock).toHaveBeenCalled()
    expect(useTabs.getState().reconciliando).toBe(false)
  })
})

describe('stores/tabs: limparTudo (sair da conta)', () => {
  it('esvazia abas, ativa e rascunhos guardados, e volta a reconciliar na próxima entrada', () => {
    definir([tk(1, 'texto'), sec('/quadro')], 'ticket:1')
    useTabs.setState({ rascunhosGuardados: [{ ticketId: 9, draft: 'guardado' }] })

    useTabs.getState().limparTudo()

    const s = useTabs.getState()
    expect(s.tabs).toEqual([])
    expect(s.active).toBeNull()
    expect(s.rascunhosGuardados).toEqual([])
    expect(s.reconciliando).toBe(true)
  })

  it('o localStorage (resolv:tabs) também fica sem abas nem rascunhos', () => {
    definir([tk(1, 'texto secreto')], 'ticket:1')
    useTabs.getState().limparTudo()

    const gravado = JSON.parse(localStorage.getItem('resolv:tabs') ?? '{}')
    expect(gravado.state.tabs).toEqual([])
    expect(localStorage.getItem('resolv:tabs')).not.toContain('texto secreto')
  })

  it('cancela o PUT que estava agendado', async () => {
    useTabs.getState().abrirTicket(1, resumo(1, '#1001'))
    useTabs.getState().limparTudo()
    useTabs.setState({ reconciliando: false })

    await passarDoDebounce()

    expect(putMock).not.toHaveBeenCalled()
  })

  it('a resposta do servidor que chega depois de sair da conta é de outra sessão e não repovoa o store', async () => {
    definir([], null)
    let responder!: (r: { tabs: ReturnType<typeof resumo>[]; active_ticket_id: number | null }) => void
    getMock.mockReturnValue(new Promise((resolve) => (responder = resolve)))

    const pronta = useTabs.getState().reconciliar()
    useTabs.getState().limparTudo()
    responder({ tabs: [resumo(5, '#1005')], active_ticket_id: 5 })
    await pronta

    expect(useTabs.getState().tabs).toEqual([])
    expect(useTabs.getState().reconciliando).toBe(true)
  })
})

describe('stores/tabs: localStorage corrompido na versão atual', () => {
  it('itens inválidos numa v3 já gravada são descartados ao carregar, em vez de derrubar o console', async () => {
    localStorage.setItem(
      'resolv:tabs',
      JSON.stringify({
        version: 3,
        state: {
          tabs: [null, 42, { tipo: 'ticket' }, { tipo: 'ticket', ticketId: 3, draft: 'ok' }, { tipo: 'secao', rota: '/quadro' }],
          active: 'ticket:99',
          rascunhosGuardados: [null, { ticketId: 'x' }, { ticketId: 4, draft: '  ' }, { ticketId: 5, draft: 'guardado' }],
        },
      }),
    )

    await useTabs.persist.rehydrate()

    const s = useTabs.getState()
    expect(ordem()).toEqual([3, '/quadro'])
    expect(s.active).toBeNull()
    expect(s.rascunhosGuardados).toEqual([{ ticketId: 5, draft: 'guardado' }])
    const tres = s.tabs[0]
    expect(tres?.tipo === 'ticket' && tres.draft).toBe('ok')
  })

  it('sem nada gravado, começa vazio', async () => {
    localStorage.removeItem('resolv:tabs')

    await useTabs.persist.rehydrate()

    expect(useTabs.getState().tabs).toEqual([])
    expect(useTabs.getState().rascunhosGuardados).toEqual([])
  })
})
