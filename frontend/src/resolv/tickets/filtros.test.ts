import { describe, expect, it } from 'vitest'
import {
  DIMENSOES,
  mudancaAoAlternar,
  opcoesComSelecionados,
  opcoesDe,
  resumoDaDimensao,
} from './dimensoes'
import {
  contarFiltros,
  jsonParaRecorte,
  lerFiltros,
  recorteParaJson,
  recortesIguais,
} from './filtros'
import { resumirLote } from './lote'
import type { Facetas } from './tipos'

const dim = (chave: string) => DIMENSOES.find((d) => d.chave === chave)!

describe('filtros da fila', () => {
  it('lê só as chaves que a listagem entende', () => {
    const f = lerFiltros(
      new URLSearchParams('status=new,open&team=suporte&view=todos&offset=25&x=1'),
    )
    expect(f).toEqual({ status: 'new,open', team: 'suporte' })
  })

  it('solicitante: `?solicitante=` na URL, `requester` na API e na visão salva', () => {
    const r = { view: 'todos', filtros: { solicitante: '41', team: 'suporte' } }
    expect(recorteParaJson(r)).toEqual({ view: 'todos', requester: '41', team: 'suporte' })
    expect(jsonParaRecorte({ view: 'todos', requester: '41' }).filtros).toEqual({
      solicitante: '41',
    })
  })

  it('período conta como UM filtro, mesmo com desde e até', () => {
    expect(contarFiltros({ desde: '2026-09-01', ate: '2026-09-30', priority: 'urgent' })).toBe(2)
  })

  it('recortes iguais ignoram a ordem dos valores de lista e as chaves vazias', () => {
    const a = recorteParaJson({ view: 'todos', filtros: { priority: 'high,urgent' } })
    expect(recortesIguais(a, { view: 'todos', priority: 'urgent,high', team: '' })).toBe(true)
    expect(recortesIguais(a, { view: 'todos', priority: 'urgent' })).toBe(false)
  })

  it('lista liga/desliga o valor; valor único troca e desmarca no segundo clique', () => {
    expect(mudancaAoAlternar(dim('priority'), { priority: 'high' }, 'urgent')).toEqual({
      priority: 'high,urgent',
    })
    expect(mudancaAoAlternar(dim('priority'), { priority: 'high' }, 'high')).toEqual({
      priority: undefined,
    })
    expect(mudancaAoAlternar(dim('team'), { team: 'suporte' }, 'suporte')).toEqual({
      team: undefined,
    })
    expect(mudancaAoAlternar(dim('periodo'), { desde: '2026-09-01' }, '7d')).toEqual({
      periodo: '7d',
      desde: undefined,
      ate: undefined,
    })
  })

  it('responsável começa por "Eu" e "Sem responsável", com as contagens da faceta', () => {
    const facetas = {
      assignee: [
        { value: null, label: 'Não atribuído', count: 4 },
        { value: 2, label: 'Samuel', count: 3 },
        { value: 9, label: 'Ana', count: 1 },
      ],
    } as unknown as Facetas
    expect(opcoesDe('assignee', facetas, 2)).toEqual([
      { valor: 'me', rotulo: 'Eu', contagem: 3 },
      { valor: 'unassigned', rotulo: 'Sem responsável', contagem: 4 },
      { valor: '9', rotulo: 'Ana', contagem: 1 },
    ])
  })

  it('selecionado que sumiu da faceta continua na lista, para dar para desmarcar', () => {
    const opcoes = opcoesComSelecionados(
      [{ valor: 'suporte', rotulo: 'Suporte', contagem: 2 }],
      ['vendas'],
    )
    expect(opcoes.map((o) => o.valor)).toEqual(['suporte', 'vendas'])
  })

  it('resumo da pílula: até dois nomes, depois "+N"; período em datas curtas', () => {
    const opcoes = opcoesDe('status', undefined)
    expect(resumoDaDimensao('status', { status: 'new,open,closed' }, opcoes)).toBe(
      'Novo, Aberto +1',
    )
    expect(resumoDaDimensao('periodo', { desde: '2026-09-03', ate: '2026-09-10' }, [])).toBe(
      '03/09 a 10/09',
    )
    expect(resumoDaDimensao('periodo', { periodo: '7d' }, [])).toBe('Últimos 7 dias')
  })
})

describe('resumo das ações em lote', () => {
  it('tudo certo', () => {
    expect(resumirLote({ updated: [1, 2, 3], failed: [] }, 'encerrar')).toEqual({
      tipo: 'sucesso',
      texto: '3 tickets encerrados.',
    })
  })

  it('parte ignorada: diz quantos e por quê, agrupando o mesmo motivo', () => {
    const r = resumirLote(
      {
        updated: [1],
        failed: [
          { id: 2, detail: 'Ticket já está fechado.' },
          { id: 3, detail: 'Ticket já está fechado.' },
          { id: 4, detail: 'Já está neste status.' },
        ],
      },
      'status',
    )
    expect(r).toEqual({
      tipo: 'parcial',
      texto: '1 ticket atualizado. 3 ignorados: Ticket já está fechado (2); Já está neste status.',
    })
  })

  it('nada mudou é falha', () => {
    expect(resumirLote({ updated: [], failed: [{ id: 2, detail: '' }] }, 'atribuir').tipo).toBe(
      'falha',
    )
  })
})
