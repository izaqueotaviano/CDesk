import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components'
import { AbaBackup } from './AbaBackup'

const ROTA = '/api/v1/ferramentas/backups/'
const NOME = 'resolv-20260901-230000.sql.gz'

const trabalho = (extra: Record<string, unknown> = {}) => ({
  id: 3, status: 'pendente', status_label: 'Na fila', etapa: '', progresso: null, log: [], erro: '',
  created_at: '2026-09-10T15:00:00Z', started_at: null, finished_at: null, requested_by_name: 'Alice',
  tipo: 'backup', tipo_label: 'Backup', origem: 'manual', origem_label: 'Manual', arquivo_nome: '', tamanho_bytes: null,
  ...extra,
})

let chamadas: { url: string; metodo: string; corpo: unknown }[]
let agendamento: Record<string, unknown>

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  agendamento = { ativo: false, frequencia: 'diaria', hora: '23:00', dia_da_semana: null, retencao_dias: 30, proximo_em: null }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      chamadas.push({ url: u.pathname, metodo, corpo })
      if (u.pathname === `${ROTA}agendamento/`) {
        if (metodo === 'PUT') agendamento = { ...agendamento, ...(corpo as object), proximo_em: '2026-09-15T02:00:00' }
        return Promise.resolve(jsonDe(agendamento))
      }
      if (u.pathname === ROTA && metodo === 'GET') {
        return Promise.resolve(jsonDe({
          em_andamento: null,
          arquivos: [{ nome: NOME, tamanho_bytes: 2_048_000, criado_em: '2026-09-01T23:00:05Z', origem: 'agendado' }],
          recentes: [], diretorio: '/var/backups/resolv', retencao_dias: 30,
        }))
      }
      if (u.pathname === ROTA && metodo === 'POST') return Promise.resolve(jsonDe(trabalho(), 201))
      if (u.pathname.endsWith('/restaurar/')) return Promise.resolve(jsonDe(trabalho({ tipo: 'restauracao', tipo_label: 'Restauração', arquivo_nome: NOME }), 202))
      return Promise.resolve(jsonDe({ detail: 'sem rota' }, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AbaBackup />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('AbaBackup', () => {
  it('lista o arquivo com origem e tamanho, e "criar agora" dispara o POST', async () => {
    montar()
    expect(await screen.findByText(NOME)).toBeInTheDocument()
    expect(screen.getByText('Agendado')).toBeInTheDocument()
    expect(screen.getByText(/MB/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Criar backup agora' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === ROTA && c.metodo === 'POST')).toBe(true))
  })

  it('restaurar exige digitar a palavra antes de liberar o botão', async () => {
    montar()
    await screen.findByText(NOME)
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }))
    const dialogo = await screen.findByRole('dialog')
    const confirmar = within(dialogo).getByRole('button', { name: 'Restaurar agora' })
    expect(confirmar).toBeDisabled()
    fireEvent.change(within(dialogo).getByLabelText(/Digite RESTAURAR/), { target: { value: 'restaurar' } })
    expect(confirmar).toBeEnabled()
    fireEvent.click(confirmar)
    await waitFor(() => expect(chamadas.some((c) => c.url === `${ROTA}${NOME}/restaurar/` && c.metodo === 'POST')).toBe(true))
    const post = chamadas.find((c) => c.url === `${ROTA}${NOME}/restaurar/`)!
    expect(post.corpo).toEqual({ confirmacao: 'RESTAURAR' })
  })

  it('agendamento semanal só salva com o dia escolhido, e manda o payload certo', async () => {
    montar()
    const salvar = await screen.findByRole('button', { name: 'Salvar agendamento' })
    expect(salvar).toBeDisabled() // nada mudou ainda
    fireEvent.click(screen.getByRole('switch', { name: 'Desligado' }))
    fireEvent.change(screen.getByLabelText('Frequência'), { target: { value: 'semanal' } })
    expect(salvar).toBeDisabled() // falta o dia
    fireEvent.change(screen.getByLabelText('Dia'), { target: { value: '1' } })
    expect(salvar).toBeEnabled()
    fireEvent.click(salvar)
    await waitFor(() => expect(chamadas.some((c) => c.url === `${ROTA}agendamento/` && c.metodo === 'PUT')).toBe(true))
    const put = chamadas.find((c) => c.url === `${ROTA}agendamento/` && c.metodo === 'PUT')!
    expect(put.corpo).toEqual({ ativo: true, frequencia: 'semanal', hora: '23:00', dia_da_semana: 1 })
  })
})
