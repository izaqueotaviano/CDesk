import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { PaginaConta } from './PaginaConta'

/**
 * Minha conta do console: as preferências de quem usa o produto o dia
 * inteiro. O que estas travas protegem: cada controle mexe na preferência
 * certa (a mesma que o resto do app lê), as chaves de aviso gravam o tipo e
 * o canal certos, e a tela não oferece chave que não faz nada (e-mail de um
 * tipo que o servidor nunca manda; ausência automática para cliente).
 */

let me: Record<string, unknown>
let puts: unknown[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const TODOS = ['ticket_created', 'ticket_assigned', 'ticket_owner_set', 'ticket_replied', 'ticket_reopened', 'mention', 'sla_warning', 'sla_breached', 'chat_incoming', 'announcement', 'attachment_blocked', 'lgpd_deadline', 'kanban_due']

beforeEach(() => {
  // jsdom não tem matchMedia, e o Toaster (sonner) o consulta ao montar
  vi.stubGlobal('matchMedia', (consulta: string) => ({
    matches: false,
    media: consulta,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
  puts = []
  me = {
    id: 1, full_name: 'Samuel Suporte', email: 'samuel@x.test', kind: 'internal',
    is_internal: true, is_admin: false, presence: 'available', permissions: [],
    avatar_url: '', signature: '', signature_kind: '', signature_html: '',
    signature_image_url: '', signature_render: '', ui_density: '',
  }
  const prefs = {
    in_app: Object.fromEntries(TODOS.map((k) => [k, true])),
    email: Object.fromEntries(TODOS.map((k) => [k, true])),
    kinds: [],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const caminho = new URL(String(url), 'http://x').pathname
      if (caminho === '/api/v1/auth/me/') return Promise.resolve(jsonDe(me))
      if (caminho === '/api/v1/notification-preferences/') {
        if (init?.method === 'PUT') {
          const corpo = JSON.parse(String(init.body))
          puts.push(corpo)
          for (const canal of ['in_app', 'email'] as const) Object.assign(prefs[canal], corpo[canal] ?? {})
        }
        return Promise.resolve(jsonDe(prefs))
      }
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  usePrefs.setState({ tamanhoTexto: 'padrao', densidade: 'compacta', ausenciaAutomatica: 15, somNotificacoes: true })
  document.documentElement.removeAttribute('data-tamanho-texto')
  document.documentElement.style.removeProperty('--escala-texto')
})

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PaginaConta />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Minha conta (console)', () => {
  it('organiza as seções num menu de âncoras, na ordem de quem usa todo dia', async () => {
    montar()
    await screen.findByText('Samuel Suporte · samuel@x.test')
    // dois menus (fita no celular, lateral no desktop), mesmos itens
    const [menu] = screen.getAllByRole('navigation', { name: 'Seções de Minha conta' })
    const itens = within(menu).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(itens.slice(0, 3)).toEqual(['#aparencia', '#notificacoes', '#ausencia'])
    expect(screen.getByRole('region', { name: 'Aparência' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Notificações' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Ausência automática' })).toBeInTheDocument()
  })

  it('Aparência: tamanho do texto e densidade mexem nas preferências que o app lê', async () => {
    montar()
    const texto = await screen.findByRole('radiogroup', { name: 'Tamanho do texto' })
    fireEvent.click(within(texto).getByRole('radio', { name: /Grande/ }))
    expect(usePrefs.getState().tamanhoTexto).toBe('grande')
    expect(document.documentElement.dataset.tamanhoTexto).toBe('grande')

    const densidade = screen.getByRole('radiogroup', { name: 'Densidade das listas' })
    fireEvent.click(within(densidade).getByRole('radio', { name: /Confortável/ }))
    expect(usePrefs.getState().densidade).toBe('confortavel')
  })

  it('Notificações: o som é a mesma chave do sino', async () => {
    montar()
    const som = await screen.findByRole('switch', { name: 'Som das notificações' })
    fireEvent.click(som)
    expect(usePrefs.getState().somNotificacoes).toBe(false)
  })

  it('cada chave de aviso grava só o seu tipo e o seu canal', async () => {
    montar()
    const chave = await screen.findByRole('switch', { name: 'Ticket atribuído a você por e-mail' })
    await waitFor(() => expect(chave).toHaveAttribute('aria-checked', 'true'))

    fireEvent.click(chave)
    await waitFor(() => expect(puts).toEqual([{ email: { ticket_assigned: false } }]))
    expect(chave).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('switch', { name: 'SLA em risco no Resolv' }))
    await waitFor(() => expect(puts[1]).toEqual({ in_app: { sla_warning: false } }))
  })

  it('tipo que não vai por e-mail não ganha chave de e-mail', async () => {
    montar()
    await screen.findByRole('switch', { name: 'Resposta do cliente no Resolv' })
    expect(screen.queryByRole('switch', { name: 'Resposta do cliente por e-mail' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Este aviso não vai por e-mail').length).toBeGreaterThan(0)
  })

  it('prazo de pedido LGPD só aparece para administrador', async () => {
    montar()
    await screen.findByRole('switch', { name: 'Ticket atribuído a você no Resolv' })
    expect(screen.queryByText('Prazo de pedido LGPD')).not.toBeInTheDocument()
  })

  it('Ausência automática: escolher o tempo muda a preferência que o vigia usa', async () => {
    montar()
    const grupo = await screen.findByRole('radiogroup', { name: 'Ficar Ausente depois de' })
    expect(within(grupo).getByRole('radio', { name: '15 min' })).toBeChecked()
    fireEvent.click(within(grupo).getByRole('radio', { name: 'Nunca' }))
    expect(usePrefs.getState().ausenciaAutomatica).toBe(0)
  })

  it('cliente não vê ausência automática (presença é só da equipe)', async () => {
    me = { ...me, is_internal: false, kind: 'client' }
    montar()
    await screen.findByText('Samuel Suporte · samuel@x.test')
    expect(screen.queryByRole('region', { name: 'Ausência automática' })).not.toBeInTheDocument()
  })
})
