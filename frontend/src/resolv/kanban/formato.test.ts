import { describe, expect, it } from 'vitest'
import { COR_DO_STATUS, contagemDaColuna, contraste, coresDaBarra, descreverPrazo, descreverSla, duracaoPorExtenso } from './formato'

// Datas LOCAIS (sem Z): o prazo é classificado pelo dia do relógio de quem
// olha, então o teste não pode depender do fuso da máquina que roda.
const AGORA = new Date(2026, 8, 29, 10, 0) // 29/09/2026 10:00
const iso = (d: Date) => d.toISOString()

describe('descreverPrazo', () => {
  it('vencido: tom de perigo, com a data (ou a hora, se foi hoje)', () => {
    const ontem = descreverPrazo(iso(new Date(2026, 8, 17, 22, 35)), AGORA)
    expect(ontem).toMatchObject({ tom: 'vencido', rotulo: 'Venceu 17/09' })
    expect(ontem.descricao).toBe('Prazo interno vencido em 17/09/2026 às 22:35')

    const hojeCedo = descreverPrazo(iso(new Date(2026, 8, 29, 8, 5)), AGORA)
    expect(hojeCedo).toMatchObject({ tom: 'vencido', rotulo: 'Venceu 08:05' })
  })

  it('o is_overdue do servidor manda, mesmo que o relógio local discorde', () => {
    expect(descreverPrazo(iso(new Date(2026, 8, 29, 10, 1)), AGORA, true).tom).toBe('vencido')
  })

  it('hoje e amanhã: tom de alerta', () => {
    expect(descreverPrazo(iso(new Date(2026, 8, 29, 14, 30)), AGORA)).toMatchObject({ tom: 'proximo', rotulo: 'Hoje 14:30' })
    expect(descreverPrazo(iso(new Date(2026, 8, 30, 9, 0)), AGORA)).toMatchObject({ tom: 'proximo', rotulo: 'Amanhã 09:00' })
  })

  it('mais longe: neutro, e o ano só aparece quando não é o atual', () => {
    expect(descreverPrazo(iso(new Date(2026, 9, 2, 9, 0)), AGORA)).toMatchObject({ tom: 'neutro', rotulo: '02/10' })
    expect(descreverPrazo(iso(new Date(2027, 0, 5, 9, 0)), AGORA).rotulo).toBe('05/01/2027')
  })
})

describe('descreverSla', () => {
  it('estourado diz qual relógio e há quanto tempo', () => {
    const minutos = -(21 * 1440 + 2 * 60)
    expect(descreverSla({ due_at: null, state: 'breached', minutes_left: minutos }, 'resolution')).toBe(
      'SLA de resolução estourado há 21 dias',
    )
  })

  it('em risco e no prazo dizem quanto falta', () => {
    expect(descreverSla({ due_at: null, state: 'at_risk', minutes_left: 45 }, 'first_response')).toBe(
      'SLA de primeira resposta em risco: vence em 45 minutos',
    )
    expect(descreverSla({ due_at: null, state: 'ok', minutes_left: 180 }, 'resolution')).toBe(
      'SLA de resolução vence em 3 horas',
    )
  })

  it('singular e unidades', () => {
    expect(duracaoPorExtenso(1)).toBe('1 minuto')
    expect(duracaoPorExtenso(-60)).toBe('1 hora')
    expect(duracaoPorExtenso(1440 + 600)).toBe('1 dia')
  })
})

describe('contagemDaColuna', () => {
  it('sem limite e sem filtro: só o número', () => {
    expect(contagemDaColuna(3, 3, null, false)).toMatchObject({ texto: '3', acima: false, descricao: '3 tickets' })
  })

  it('com limite: "total/limite", e acima só quando passa (não quando empata)', () => {
    expect(contagemDaColuna(3, 3, 3, false)).toMatchObject({ texto: '3/3', acima: false })
    const acima = contagemDaColuna(4, 4, 3, false)
    expect(acima).toMatchObject({ texto: '4/3', acima: true })
    expect(acima.descricao).toBe('4 tickets, limite de 3. Acima do limite')
  })

  it('com filtro: mostra o recorte e o todo, e o limite continua medindo o todo', () => {
    const c = contagemDaColuna(1, 4, 3, true)
    expect(c.texto).toBe('1 de 4')
    expect(c.acima).toBe(true)
    expect(c.descricao).toBe('1 de 4 tickets com os filtros atuais, limite de 3. Acima do limite')
  })

  it('com filtro que não escondeu nada na coluna, não repete o número', () => {
    expect(contagemDaColuna(1, 1, null, true).texto).toBe('1')
    expect(contagemDaColuna(0, 0, null, true).texto).toBe('0')
    expect(contagemDaColuna(2, 2, 1, true).texto).toBe('2/1')
  })
})

describe('coresDaBarra', () => {
  it('as cores de fábrica dos status sempre saem com contraste AA (4,5:1) entre fundo e tinta', () => {
    for (const cor of Object.values(COR_DO_STATUS)) {
      const { fundo, texto } = coresDaBarra(cor)
      expect(contraste(fundo, texto), cor).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('cor clara (âmbar) ganha tinta escura em vez de fundo escurecido', () => {
    expect(coresDaBarra('#E9A23B')).toEqual({ fundo: '#e9a23b', texto: '#1f1f1f' })
  })

  it('cor escura mantém o fundo e ganha tinta branca', () => {
    expect(coresDaBarra('#6c4e9c')).toEqual({ fundo: '#6c4e9c', texto: '#ffffff' })
  })

  it('azul médio escurece só o que falta para o branco chegar a 4,5:1', () => {
    const { fundo, texto } = coresDaBarra('#5A87B8')
    expect(texto).toBe('#ffffff')
    expect(fundo).not.toBe('#5a87b8')
    expect(contraste(fundo, texto)).toBeGreaterThanOrEqual(4.5)
  })

  it('cor inválida ou vazia cai no cinza neutro, também legível', () => {
    for (const ruim of ['', 'azul', '#12', 'rgb(0,0,0)']) {
      const { fundo, texto } = coresDaBarra(ruim)
      expect(contraste(fundo, texto), ruim).toBeGreaterThanOrEqual(4.5)
    }
  })
})
