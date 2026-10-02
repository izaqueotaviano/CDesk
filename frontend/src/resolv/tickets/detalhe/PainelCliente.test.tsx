import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PainelCliente } from './PainelCliente'
import type { TicketDetalhe } from './tiposDetalhe'

const AGORA = Date.parse('2026-09-06T13:00:00Z')

function ticket(extra: Partial<TicketDetalhe> = {}): TicketDetalhe {
  return {
    id: 42,
    reference: '#1042',
    subject: 'Impressora fiscal não emite',
    order_number: '',
    satisfaction: null,
    status: 'open',
    stage: null,
    stage_name: 'Aberto',
    stage_color: '#888888',
    priority: 'high',
    source: 'web',
    team: { id: 1, name: 'Suporte', slug: 'suporte' },
    requester_display: 'Beto Barros',
    assignee_name: null,
    assignee_id: null,
    owner_name: null,
    owner_id: null,
    company_name: 'Acme Marketing',
    category: null,
    category_name: null,
    current_status_note: null,
    is_restricted: false,
    content_hidden: false,
    sla: {
      first_response: { due_at: null, state: 'none', minutes_left: null },
      resolution: { due_at: null, state: 'none', minutes_left: null },
    },
    tags: [],
    created_at: '2026-09-01T10:00:00Z',
    first_response_at: null,
    messages: [],
    events: [],
    watchers: [],
    scheduled_replies: [],
    requester: {
      name: 'Beto Barros',
      email: 'beto@acme.test',
      ui_language: 'pt-br',
      timezone: 'America/Sao_Paulo',
    },
    ...extra,
  }
}

const montar = (extra: Partial<TicketDetalhe> = {}) =>
  render(<PainelCliente ticket={ticket(extra)} agoraMs={AGORA} />)

describe('PainelCliente — número do pedido', () => {
  it('mostra o pedido com um botão de copiar que se identifica sozinho', () => {
    montar({ order_number: 'PED-99381' })

    expect(screen.getByText('PED-99381')).toBeInTheDocument()
    // O botão é só ícone: sem aria-label próprio ele seria "Copiar" duas vezes
    // na mesma tela (o outro copia o e-mail).
    expect(screen.getByRole('button', { name: 'Copiar número do pedido' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copiar e-mail' })).toBeInTheDocument()
  })

  it('diz que o pedido não foi informado em vez de esconder a linha', () => {
    // Esconder a linha faria o agente continuar caçando o número dentro da
    // primeira mensagem — que é exatamente o hábito que esta linha encerra.
    montar({ order_number: '' })

    expect(screen.getByText('Nº do pedido')).toBeInTheDocument()
    expect(screen.getByText('não informado na abertura')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copiar número do pedido' })).toBeNull()
  })
})

describe('PainelCliente — avaliação de quem atendeu', () => {
  it('mostra a nota e o comentário que o cliente deixou', () => {
    montar({
      status: 'closed',
      satisfaction: {
        score: 9,
        comment: 'Resolveram no mesmo dia.',
        responded_at: '2026-09-05T18:20:00Z',
      },
    })

    expect(screen.getByText('Nota 9 de 10')).toBeInTheDocument()
    expect(screen.getByText('Resolveram no mesmo dia.')).toBeInTheDocument()
  })

  it('trata nota 0 como nota, não como pesquisa sem resposta', () => {
    // A escala do backend é 0–10 (services/satisfaction.answer): zero é a pior
    // nota possível, e é justamente a que ninguém pode deixar de ver.
    montar({ status: 'closed', satisfaction: { score: 0, comment: '', responded_at: null } })

    expect(screen.getByText('Nota 0 de 10')).toBeInTheDocument()
    expect(screen.getByText('Sem comentário')).toBeInTheDocument()
    expect(screen.queryByText('pesquisa ainda sem resposta')).toBeNull()
  })

  it('em chamado fechado sem resposta, diz que a pesquisa está sem resposta', () => {
    montar({ status: 'closed', satisfaction: null })

    expect(screen.getByText('pesquisa ainda sem resposta')).toBeInTheDocument()
  })

  it('em chamado aberto não fala de avaliação — a pesquisa só nasce no fechamento', () => {
    montar({ status: 'open', satisfaction: null })

    expect(screen.queryByText('Avaliação')).toBeNull()
  })
})
