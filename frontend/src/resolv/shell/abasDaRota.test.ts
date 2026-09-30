import { describe, expect, it } from 'vitest'
import { CHAVE_INICIO, SECOES, abaDaRota, secaoDaRota, ticketDaRota, vizinhaAposFechar } from './abasDaRota'

describe('abasDaRota: qual aba a URL acende', () => {
  it('/inicio é a aba fixa; a barra final não muda nada', () => {
    expect(abaDaRota('/inicio')).toEqual({ chave: CHAVE_INICIO })
    expect(abaDaRota('/inicio/')).toEqual({ chave: CHAVE_INICIO })
  })

  it('/tickets/27 (id numérico) é aba de ticket, e não da seção Tickets', () => {
    expect(abaDaRota('/tickets/27')).toEqual({ chave: 'ticket:27' })
    expect(ticketDaRota('/tickets/27')).toBe(27)
    expect(ticketDaRota('/tickets/novo')).toBeUndefined()
    expect(ticketDaRota('/tickets')).toBeUndefined()
    expect(ticketDaRota('/clientes/27')).toBeUndefined()
  })

  it('maior prefixo: /tickets, /tickets/novo e /tickets/27 são três abas diferentes', () => {
    expect(abaDaRota('/tickets')?.chave).toBe('secao:/tickets')
    expect(abaDaRota('/tickets/novo')?.chave).toBe('secao:/tickets/novo')
    expect(abaDaRota('/tickets/27')?.chave).toBe('ticket:27')
  })

  it('/clientes e /clientes/3 dividem a mesma aba Clientes', () => {
    expect(abaDaRota('/clientes')?.chave).toBe('secao:/clientes')
    expect(abaDaRota('/clientes/3')?.chave).toBe('secao:/clientes')
    expect(abaDaRota('/clientes/3')?.secao?.rotulo).toBe('Clientes')
  })

  it('rótulos e ícones das seções saem do NAV da Sidebar, mais Novo ticket e Minha conta', () => {
    const rotulos = Object.fromEntries(SECOES.map((s) => [s.rota, s.rotulo]))
    expect(rotulos).toMatchObject({
      '/tickets': 'Tickets',
      '/chat': 'Chats',
      '/quadro': 'Quadro',
      '/clientes': 'Clientes',
      '/avisos': 'Avisos',
      '/notas': 'Notas',
      '/relatorios': 'Relatórios',
      '/auditoria': 'Auditoria e LGPD',
      '/configuracoes': 'Configurações',
      '/tickets/novo': 'Novo ticket',
      '/conta': 'Minha conta',
    })
    expect(secaoDaRota('/tickets/novo')?.icone).toBe('ti ti-plus')
    expect(secaoDaRota('/conta')?.icone).toBe('ti ti-user-circle')
    // A Início é fixa e o Calendário ainda não tem tela: nenhum dos dois é seção.
    expect(rotulos['/inicio']).toBeUndefined()
    expect(rotulos['/calendario']).toBeUndefined()
  })

  it('subcaminhos de uma seção caem nela; prefixo parcial de palavra não', () => {
    expect(abaDaRota('/configuracoes/sla')?.chave).toBe('secao:/configuracoes')
    expect(abaDaRota('/clientesx')).toBeNull()
  })

  it('rota desconhecida não acende aba nenhuma', () => {
    expect(abaDaRota('/calendario')).toBeNull()
    expect(abaDaRota('/qualquer/coisa')).toBeNull()
  })
})

describe('vizinhaAposFechar: para onde vai o foco/rota quando abas fecham', () => {
  const chaves = ['inicio', 'a', 'b', 'c']

  it('a da direita, se houver', () => {
    expect(vizinhaAposFechar(chaves, new Set(['b']), 'b')).toBe('c')
  })
  it('a da esquerda, se ela era a última', () => {
    expect(vizinhaAposFechar(chaves, new Set(['c']), 'c')).toBe('b')
  })
  it('a Início, se não sobrou nenhuma outra', () => {
    expect(vizinhaAposFechar(chaves, new Set(['a', 'b', 'c']), 'b')).toBe('inicio')
  })
  it('pula as que fecham junto', () => {
    expect(vizinhaAposFechar(chaves, new Set(['b', 'c']), 'b')).toBe('a')
    expect(vizinhaAposFechar(chaves, new Set(['a', 'b']), 'a')).toBe('c')
  })
  it('null quando a origem não está na lista', () => {
    expect(vizinhaAposFechar(chaves, new Set(['x']), 'x')).toBeNull()
  })
})
