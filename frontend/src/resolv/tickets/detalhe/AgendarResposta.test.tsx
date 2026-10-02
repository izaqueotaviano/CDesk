import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '@/api/types'
import { AgendarResposta } from './AgendarResposta'
import type { RespostaAgendada, TicketDetalhe } from './tiposDetalhe'

const cancelarMock = vi.hoisted(() => vi.fn())

vi.mock('./dados', () => ({
  useAcoesTicket: () => ({
    cancelarAgendamento: { mutate: cancelarMock, isPending: false },
  }),
}))

const ME: Me = {
  id: 3,
  email: 'samuel@demo.test',
  full_name: 'Samuel Suporte',
  kind: 'internal',
  internal_role: 'agent',
  client_role: null,
  company: null,
  company_name: '',
  plan_name: '',
  is_internal: true,
  is_admin: false,
  teams: ['suporte'],
  presence: 'available',
  permissions: ['ticket.reply_public'],
  ticket_scope: 'team',
  custom_role_name: '',
  avatar_url: '',
  job_title: '',
  phone: '',
  ui_density: 'comfortable',
  signature: '',
  signature_kind: '' as const,
  signature_html: '',
  signature_image_url: '',
  signature_render: '',
}

const ME_SEM_PERMISSAO: Me = { ...ME, permissions: [] }

function agendada(extra: Partial<RespostaAgendada> = {}): RespostaAgendada {
  return {
    id: 1,
    body: 'Bom dia! Segue a atualização.',
    is_public: true,
    new_status: 'open',
    scheduled_at: '2026-09-16T11:00:00Z',
    status: 'pending',
    sent_at: null,
    error: '',
    author_name: 'Samuel Suporte',
    created_at: '2026-09-15T10:00:00Z',
    ...extra,
  }
}

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
    assignee_name: 'Samuel Suporte',
    assignee_id: 3,
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

beforeEach(() => {
  cancelarMock.mockReset()
})

describe('AgendarResposta', () => {
  it('sem a permissão de responder publicamente, não aparece nada', () => {
    render(<AgendarResposta ticket={ticket({ scheduled_replies: [agendada()] })} me={ME_SEM_PERMISSAO} />)
    expect(screen.queryByRole('list', { name: 'Respostas agendadas' })).not.toBeInTheDocument()
  })

  it('para o cliente (não interno), não aparece nada', () => {
    render(
      <AgendarResposta
        ticket={ticket({ scheduled_replies: [agendada()] })}
        me={{ ...ME, is_internal: false }}
      />,
    )
    expect(screen.queryByRole('list', { name: 'Respostas agendadas' })).not.toBeInTheDocument()
  })

  it('não tem mais um campo de texto próprio: agendar é no compositor', () => {
    render(<AgendarResposta ticket={ticket()} me={ME} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Agendar/ })).not.toBeInTheDocument()
  })

  it('mostra a resposta agendada sem os marcadores de formatação', () => {
    render(
      <AgendarResposta
        ticket={ticket({ scheduled_replies: [agendada({ body: '**Bom dia!** Segue.' })] })}
        me={ME}
      />,
    )
    expect(screen.getByText('Bom dia! Segue.')).toBeInTheDocument()
  })

  it('lista as agendadas pendentes e cancela pelo botão', () => {
    render(
      <AgendarResposta
        ticket={ticket({ scheduled_replies: [agendada(), agendada({ id: 2, status: 'sent' })] })}
        me={ME}
      />,
    )

    // só a pendente aparece — a enviada não é mais uma ação disponível
    expect(screen.getByText('Bom dia! Segue a atualização.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Cancelar' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(cancelarMock).toHaveBeenCalledWith(1)
  })

  it('sem agendamento pendente nenhum, não mostra a lista', () => {
    render(<AgendarResposta ticket={ticket()} me={ME} />)
    expect(screen.queryByRole('list', { name: 'Respostas agendadas' })).not.toBeInTheDocument()
  })
})
