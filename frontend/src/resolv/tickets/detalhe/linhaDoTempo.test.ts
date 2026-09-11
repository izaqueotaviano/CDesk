import { describe, expect, it } from 'vitest'
import {
  agruparPorDia,
  descreverEvento,
  duracaoCurta,
  interpolarMacro,
  marcadoresPendentes,
  mesclarLinhaDoTempo,
  rotuloDia,
  rotuloEnviar,
  statusInicialAoEnviar,
  tempoRelativo,
  tempoSla,
  validarFechamento,
} from './linhaDoTempo'
import type { Evento, Mensagem } from './tiposDetalhe'

function msg(id: number, created_at: string, extra: Partial<Mensagem> = {}): Mensagem {
  return {
    id,
    author_name: 'Alguém',
    author_avatar: null,
    author_is_internal: false,
    body: 'x',
    is_public: true,
    source: 'web',
    is_first_response: false,
    created_at,
    attachments: [],
    mentions: [],
    edited_at: null,
    is_deleted: false,
    can_edit: false,
    signature_html: '',
    ...extra,
  }
}

function ev(id: number, created_at: string, extra: Partial<Evento> = {}): Evento {
  return {
    id,
    from_status: 'new',
    to_status: 'open',
    actor_name: 'Samuel',
    is_reopen: false,
    is_automatic: false,
    note: '',
    created_at,
    ...extra,
  }
}

// "agora" fixo: 05/09/2026 15:00 no fuso local
const AGORA = new Date(2026, 8, 5, 15, 0, 0).getTime()

describe('mesclarLinhaDoTempo', () => {
  it('intercala mensagens e eventos por instante, mensagem antes do evento no empate', () => {
    const itens = mesclarLinhaDoTempo(
      [msg(2, '2026-09-05T13:00:00-03:00'), msg(1, '2026-09-05T10:00:00-03:00')],
      [ev(9, '2026-09-05T13:00:00-03:00'), ev(8, '2026-09-05T11:00:00-03:00')],
    )
    expect(
      itens.map((i) => (i.tipo === 'mensagem' ? `m${i.mensagem.id}` : `e${i.evento.id}`)),
    ).toEqual(['m1', 'e8', 'm2', 'e9'])
  })

  it('deixa os eventos de fora quando pedido', () => {
    const itens = mesclarLinhaDoTempo(
      [msg(1, '2026-09-05T10:00:00-03:00')],
      [ev(8, '2026-09-05T11:00:00-03:00')],
      false,
    )
    expect(itens).toHaveLength(1)
  })
})

describe('agruparPorDia / rotuloDia', () => {
  it('separa por dia com Hoje/Ontem e data completa para o resto', () => {
    const hoje = new Date(2026, 8, 5, 9, 0).toISOString()
    const ontem = new Date(2026, 8, 4, 22, 0).toISOString()
    const antes = new Date(2026, 8, 1, 8, 0).toISOString()
    const grupos = agruparPorDia(
      mesclarLinhaDoTempo([msg(1, antes), msg(2, ontem), msg(3, hoje)], []),
      AGORA,
    )
    expect(grupos.map((g) => g.rotulo)).toEqual(['ter., 01/09/2026', 'Ontem', 'Hoje'])
    expect(grupos[2].itens).toHaveLength(1)
  })

  it('rotuloDia não quebra com data inválida', () => {
    expect(rotuloDia('não-é-data', AGORA)).toBe('—')
  })
})

describe('tempos', () => {
  it('tempoRelativo em português curto', () => {
    expect(tempoRelativo(new Date(AGORA - 20_000).toISOString(), AGORA)).toBe('agora')
    expect(tempoRelativo(new Date(AGORA - 5 * 60_000).toISOString(), AGORA)).toBe('há 5 min')
    expect(tempoRelativo(new Date(AGORA - 3 * 3_600_000).toISOString(), AGORA)).toBe('há 3h')
    expect(tempoRelativo(new Date(AGORA - 49 * 3_600_000).toISOString(), AGORA)).toBe('há 2d')
  })

  it('duracaoCurta', () => {
    expect(duracaoCurta(35)).toBe('35min')
    expect(duracaoCurta(135)).toBe('2h 15min')
    expect(duracaoCurta(120)).toBe('2h')
    expect(duracaoCurta(26 * 60)).toBe('1d 2h')
  })

  it('tempoSla mostra negativo quando estourado e — sem SLA', () => {
    expect(tempoSla({ due_at: null, state: 'none', minutes_left: null })).toBe('—')
    expect(tempoSla({ due_at: 'x', state: 'breached', minutes_left: -35 })).toBe('-35min')
    expect(tempoSla({ due_at: 'x', state: 'ok', minutes_left: 90 })).toBe('1h 30min')
    expect(tempoSla({ due_at: 'x', state: 'met', minutes_left: null })).toBe('ok')
  })
})

describe('descreverEvento', () => {
  it('fala quem fez o quê', () => {
    expect(
      descreverEvento(ev(1, '', { from_status: null, to_status: 'new', actor_name: null })).texto,
    ).toBe('Ticket aberto')
    expect(descreverEvento(ev(1, '', { to_status: 'closed', actor_name: 'Alice' })).texto).toBe(
      'Alice fechou o ticket',
    )
    expect(
      descreverEvento(ev(1, '', { to_status: 'closed', is_automatic: true, actor_name: null }))
        .texto,
    ).toBe('Fechado automaticamente por falta de resposta')
    expect(
      descreverEvento(
        ev(1, '', {
          from_status: 'closed',
          to_status: 'open',
          is_reopen: true,
          is_automatic: true,
        }),
      ).texto,
    ).toBe('Reaberto pela resposta do cliente')
    expect(
      descreverEvento(ev(1, '', { to_status: 'pending_customer', actor_name: 'Samuel' })).texto,
    ).toBe('Samuel moveu para Aguardando retorno')
    expect(
      descreverEvento(
        ev(1, '', {
          from_status: 'open',
          to_status: 'open',
          actor_name: 'Alice',
          note: 'aplicou macro',
        }),
      ).texto,
    ).toBe('Alice atualizou o ticket')
  })
})

describe('compositor', () => {
  it('statusInicialAoEnviar mantém o atual ou volta para Aberto', () => {
    expect(statusInicialAoEnviar('pending_customer')).toBe('pending_customer')
    expect(statusInicialAoEnviar('closed')).toBe('open')
    expect(statusInicialAoEnviar('new')).toBe('open')
  })

  it('rotuloEnviar diz as duas consequências', () => {
    expect(
      rotuloEnviar({
        publico: true,
        statusAtual: 'open',
        statusEscolhido: 'closed',
        enviando: false,
      }),
    ).toBe('Enviar e fechar')
    expect(
      rotuloEnviar({
        publico: true,
        statusAtual: 'closed',
        statusEscolhido: 'open',
        enviando: false,
      }),
    ).toBe('Enviar e reabrir')
    expect(
      rotuloEnviar({
        publico: true,
        statusAtual: 'open',
        statusEscolhido: 'open',
        enviando: false,
      }),
    ).toBe('Enviar resposta')
    expect(
      rotuloEnviar({
        publico: false,
        statusAtual: 'open',
        statusEscolhido: 'open',
        enviando: false,
      }),
    ).toBe('Salvar nota')
    expect(
      rotuloEnviar({ publico: true, statusAtual: 'open', statusEscolhido: 'open', enviando: true }),
    ).toBe('Enviando…')
  })

  it('validarFechamento aplica as mesmas regras do backend (D4), no minuto', () => {
    const criadoEm = new Date(2026, 8, 5, 10, 0, 35).toISOString() // 10:00:35
    const ok = validarFechamento({
      criadoEm,
      inicio: '2026-09-05T10:00',
      fim: '2026-09-05T14:00',
      agoraMs: AGORA,
    })
    expect(ok).toEqual({})
    expect(
      validarFechamento({
        criadoEm,
        inicio: '2026-09-05T09:59',
        fim: '2026-09-05T14:00',
        agoraMs: AGORA,
      }).inicio,
    ).toMatch(/antes da abertura/)
    expect(
      validarFechamento({
        criadoEm,
        inicio: '2026-09-05T12:00',
        fim: '2026-09-05T11:00',
        agoraMs: AGORA,
      }).fim,
    ).toMatch(/antes do início/)
    expect(
      validarFechamento({
        criadoEm,
        inicio: '2026-09-05T12:00',
        fim: '2026-09-05T16:00',
        agoraMs: AGORA,
      }).fim,
    ).toMatch(/no futuro/)
    expect(validarFechamento({ criadoEm, inicio: '', fim: '', agoraMs: AGORA })).toEqual({
      inicio: 'Informe quando a solução começou.',
      fim: 'Informe quando a solução terminou.',
    })
  })

  it('interpolarMacro preenche o que sabe e deixa o resto visível', () => {
    const texto = interpolarMacro('Oi, {{solicitante}} da {{empresa}} — {{pedido}}', {
      solicitante: 'Beto Barros',
      empresa: 'Acme',
    })
    expect(texto).toBe('Oi, Beto da Acme — {{pedido}}')
    expect(marcadoresPendentes(texto)).toEqual(['{{pedido}}'])
  })
})
