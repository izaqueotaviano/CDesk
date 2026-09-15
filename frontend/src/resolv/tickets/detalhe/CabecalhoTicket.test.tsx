import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import type { Me } from '@/api/types'
import { CabecalhoTicket } from './CabecalhoTicket'
import type { TicketDetalhe } from './tiposDetalhe'

const baixarMock = vi.hoisted(() => vi.fn())

vi.mock('@/portal/api/tickets', () => ({ baixarPdfDoTicket: baixarMock }))

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
  permissions: ['ticket.be_assigned', 'ticket.close'],
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
    requester: null,
    ...extra,
  }
}

function montar(extra: Partial<TicketDetalhe> = {}, onAssumir = vi.fn()) {
  render(
    <MemoryRouter>
      <CabecalhoTicket
        ticket={ticket(extra)}
        me={ME}
        assumindo={false}
        onAssumir={onAssumir}
        onFechar={vi.fn()}
        onReabrir={vi.fn()}
        painelAberto={null}
        onAlternarPainel={vi.fn()}
      />
    </MemoryRouter>,
  )
  return onAssumir
}

beforeEach(() => {
  baixarMock.mockReset().mockResolvedValue(undefined)
})

describe('CabecalhoTicket — quem é o responsável', () => {
  it('mostra o responsável na linha de meta, que não some em tela estreita', () => {
    // O painel de propriedades vira gaveta abaixo de 900px; era o único lugar
    // com o nome do responsável, e sem ele dá para assumir sem saber que havia dono.
    montar({ assignee_id: 9, assignee_name: 'Ana Alves' })

    expect(screen.getByText('Ana Alves')).toBeInTheDocument()
  })

  it('diz "Sem responsável" quando o chamado está solto', () => {
    montar()

    expect(screen.getByText('Sem responsável')).toBeInTheDocument()
  })
})

describe('CabecalhoTicket — assumir', () => {
  it('nomeia de quem o chamado sai e só assume depois de confirmar', () => {
    const onAssumir = montar({ assignee_id: 9, assignee_name: 'Ana Alves' })

    fireEvent.click(screen.getByRole('button', { name: /Assumir de Ana/ }))

    expect(onAssumir).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Assumir de Ana Alves?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Assumir mesmo assim' }))
    expect(onAssumir).toHaveBeenCalledTimes(1)
  })

  it('cancelar a confirmação deixa o chamado com quem estava', () => {
    const onAssumir = montar({ assignee_id: 9, assignee_name: 'Ana Alves' })

    fireEvent.click(screen.getByRole('button', { name: /Assumir de Ana/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onAssumir).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sem responsável, assumir continua sendo um clique só', () => {
    // Confirmar o que não tira nada de ninguém seria só atrito.
    const onAssumir = montar()

    fireEvent.click(screen.getByRole('button', { name: 'Assumir' }))

    expect(onAssumir).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('CabecalhoTicket — exportar a transcrição', () => {
  it('pede o PDF do chamado aberto na tela', async () => {
    montar()

    fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/ }))

    await waitFor(() => expect(baixarMock).toHaveBeenCalledWith(42, '#1042'))
  })

  it('avisa que o servidor não gera PDF em vez de deixar um download quebrado', async () => {
    // O endpoint devolve 501 explícito quando falta a dependência
    // (apps/tickets/views.py `export`) — é por isso que a chamada é fetch+blob.
    baixarMock.mockRejectedValue(new ApiError(501, { detail: 'PDF indisponível' }))
    montar()

    fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A exportação em PDF não está disponível neste servidor.',
    )
  })

  it('erro qualquer vira aviso dizendo que nada foi baixado', async () => {
    baixarMock.mockRejectedValue(new ApiError(403, { detail: 'Chamado restrito ao solicitante.' }))
    montar()

    fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Chamado restrito ao solicitante.')
  })

  it('não oferece exportar o que a pessoa não pode ler', () => {
    montar({ content_hidden: true, is_restricted: true })

    expect(screen.getByRole('button', { name: /Exportar PDF/ })).toBeDisabled()
  })
})
