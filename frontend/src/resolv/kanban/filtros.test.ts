import { describe, expect, it } from 'vitest'
import {
  FILTROS_VAZIOS,
  aplicarNaUrl,
  empresasDoQuadro,
  estaAtrasado,
  filtrarCartoes,
  filtrosDaUrl,
  responsaveisDoQuadro,
  temFiltroAtivo,
} from './filtros'
import type { Cartao } from './tipos'

const semSla = { due_at: null, state: 'none' as const, minutes_left: null }

function cartao(parcial: Partial<Cartao>): Cartao {
  return {
    ticket: 1,
    ticket_reference: 'TD-00001',
    ticket_status: 'open',
    stage: 1,
    priority: 'normal',
    subject: 'Assunto',
    requester_display: 'Ana',
    company_name: 'Acme',
    team_name: 'Suporte',
    owner_id: null,
    owner_name: null,
    assignee_id: null,
    assignee_name: null,
    assignee_avatar: null,
    sla: { first_response: semSla, resolution: semSla },
    column: '1',
    message_count: 0,
    attachment_count: 0,
    due_at: null,
    is_overdue: false,
    created_at: '2026-09-01T10:00:00Z',
    ...parcial,
  }
}

const CARTOES = [
  cartao({ ticket: 1, ticket_reference: 'TD-00001', subject: 'Orçamento do site', requester_display: 'João Silva', company_name: 'Acme', assignee_id: 7, assignee_name: 'Samuel', priority: 'urgent' }),
  cartao({ ticket: 2, ticket_reference: 'TD-00027', subject: 'Teclado sem resposta', requester_display: 'Ana', company_name: 'Bravo', assignee_id: 9, assignee_name: 'Beatriz', is_overdue: true }),
  cartao({ ticket: 3, ticket_reference: 'TD-00003', subject: 'Relatório mensal', requester_display: 'Carla', company_name: 'Acme', sla: { first_response: semSla, resolution: { due_at: null, state: 'breached', minutes_left: -30 } } }),
]

describe('filtros na URL', () => {
  it('lê os parâmetros e ignora prioridade que não existe', () => {
    const f = filtrosDaUrl(new URLSearchParams('busca=tec&responsavel=eu&prioridade=altissima&empresa=Acme&atrasados=1'))
    expect(f).toEqual({ busca: 'tec', responsavel: 'eu', prioridade: '', empresa: 'Acme', atrasados: true })
  })

  it('grava só o que tem valor e preserva as outras chaves', () => {
    const url = aplicarNaUrl(new URLSearchParams('outra=1&busca=x'), { busca: '  ', prioridade: 'high', atrasados: true })
    expect(url.get('outra')).toBe('1')
    expect(url.has('busca')).toBe(false)
    expect(url.get('prioridade')).toBe('high')
    expect(url.get('atrasados')).toBe('1')
  })

  it('limpar com FILTROS_VAZIOS tira todas as chaves de filtro', () => {
    const url = aplicarNaUrl(new URLSearchParams('busca=a&responsavel=7&prioridade=low&empresa=X&atrasados=1'), FILTROS_VAZIOS)
    expect(url.toString()).toBe('')
    expect(temFiltroAtivo(filtrosDaUrl(url))).toBe(false)
  })
})

describe('filtrarCartoes', () => {
  const ids = (lista: Cartao[]) => lista.map((c) => c.ticket)

  it('busca em assunto, referência, cliente e empresa, sem acento e sem caixa', () => {
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, busca: 'orcamento' }, null))).toEqual([1])
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, busca: 'td-00027' }, null))).toEqual([2])
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, busca: 'JOAO' }, null))).toEqual([1])
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, busca: 'bravo' }, null))).toEqual([2])
  })

  it('"Eu" usa o id da sessão, e sem sessão não casa com ninguém', () => {
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, responsavel: 'eu' }, 9))).toEqual([2])
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, responsavel: 'eu' }, null))).toEqual([])
  })

  it('"Sem responsável" e responsável por id', () => {
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, responsavel: 'nenhum' }, null))).toEqual([3])
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, responsavel: '7' }, null))).toEqual([1])
  })

  it('prioridade, empresa e a combinação dos filtros', () => {
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, prioridade: 'urgent' }, null))).toEqual([1])
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, empresa: 'Acme' }, null))).toEqual([1, 3])
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, empresa: 'Acme', busca: 'relat' }, null))).toEqual([3])
  })

  it('"Só atrasados" pega prazo interno vencido E SLA estourado', () => {
    expect(estaAtrasado(CARTOES[0]!)).toBe(false)
    expect(ids(filtrarCartoes(CARTOES, { ...FILTROS_VAZIOS, atrasados: true }, null))).toEqual([2, 3])
  })
})

describe('opções dos seletores', () => {
  it('responsáveis: só quem tem chamado no quadro, em ordem alfabética', () => {
    expect(responsaveisDoQuadro(CARTOES)).toEqual([
      { id: 9, nome: 'Beatriz' },
      { id: 7, nome: 'Samuel' },
    ])
  })

  it('empresas: sem repetição, em ordem alfabética', () => {
    expect(empresasDoQuadro(CARTOES)).toEqual(['Acme', 'Bravo'])
  })
})
