import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components'
import { AbaSistema } from './AbaSistema'

/** Resposta que o `SystemConfigSerializer` devolve, com os defaults do model. */
const CONFIG = {
  attachment_max_bytes: 10 * 1024 * 1024,
  attachment_max_mb: 10,
  attachment_max_files_per_message: 10,
  attachment_max_bytes_per_message: 100 * 1024 * 1024,
  attachment_max_mb_per_message: 100,
  auto_close_pending_hours: 72,
  auto_close_message: 'Como não tivemos retorno, estamos encerrando este chamado.',
  auto_close_warning_hours: 24,
  auto_close_warning_message: 'Ainda estamos aguardando seu retorno neste chamado.',
  csat_enabled: true,
  csat_expires_days: 30,
  two_factor_required: false,
  email_enabled: true,
  smtp_host: '',
  smtp_port: 587,
  smtp_username: '',
  smtp_password_set: false,
  smtp_use_tls: true,
  smtp_use_ssl: false,
  email_from: '',
  email_html_template: '<html>{{assunto}} {{conteudo}}</html>',
  email_html_template_default: '<html>{{assunto}} {{conteudo}}</html>',
  updated_at: '2026-09-04T12:00:00Z',
}

interface Chamada {
  metodo: string
  corpo: unknown
}

let chamadas: Chamada[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Erro de validação do DRF: `{"campo": ["mensagem"]}`. */
let respostaDoPut: () => Response = () => jsonDe(CONFIG)

beforeEach(() => {
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET'
      chamadas.push({ metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined })
      return Promise.resolve(metodo === 'GET' ? jsonDe(CONFIG) : respostaDoPut())
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  respostaDoPut = () => jsonDe(CONFIG)
})

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AbaSistema />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const escritas = () => chamadas.filter((c) => c.metodo !== 'GET')

describe('AbaSistema', () => {
  it('mostra os limites de anexo em MB, não em bytes', async () => {
    montar()
    expect(await screen.findByLabelText('Máximo por arquivo (MB)')).toHaveValue(10)
    expect(screen.getByLabelText('Máximo somado por mensagem (MB)')).toHaveValue(100)
  })

  it('manda só o campo que mudou — o PUT é parcial e vira trilha de auditoria', async () => {
    montar()
    const campo = await screen.findByLabelText('Validade do link (dias)')
    fireEvent.change(campo, { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(escritas()).toHaveLength(1))
    expect(escritas()[0]).toEqual({ metodo: 'PUT', corpo: { csat_expires_days: 45 } })
  })

  // Diminuir os arquivos por mensagem derruba o teto do total (arquivo ×
  // arquivos) e pode deixar o valor JÁ salvo acima dele — o mesmo caso que o
  // `clean()` do model recusa, checado aqui no campo que o backend nomearia.
  it('acusa o teto que encolheu por causa de outro campo', async () => {
    montar()
    const arquivos = await screen.findByLabelText('Arquivos por mensagem')
    fireEvent.change(arquivos, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByText(/Não pode passar de 50 MB/)).toBeInTheDocument()
    await waitFor(() => expect(escritas()).toHaveLength(0))
  })

  it('barra o total por mensagem acima do teto antes de chamar a API', async () => {
    montar()
    const total = await screen.findByLabelText('Máximo somado por mensagem (MB)')
    fireEvent.change(total, { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByText(/Não pode passar de 100 MB/)).toBeInTheDocument()
    await waitFor(() => expect(escritas()).toHaveLength(0))
  })

  it('barra o aviso que chegaria depois do fechamento', async () => {
    montar()
    const aviso = await screen.findByLabelText('Avisar quantas horas antes')
    fireEvent.change(aviso, { target: { value: '72' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByText(/precisa chegar antes do fechamento/)).toBeInTheDocument()
    await waitFor(() => expect(escritas()).toHaveLength(0))
  })

  it('desliga o aviso junto com o fechamento automático', async () => {
    montar()
    const prazo = await screen.findByLabelText('Fechar depois de (horas)')
    fireEvent.change(prazo, { target: { value: '0' } })

    expect(screen.getByLabelText('Avisar quantas horas antes')).toBeDisabled()
    expect(screen.getByLabelText('Mensagem do fechamento')).toBeDisabled()
    expect(screen.getByLabelText('Mensagem do aviso prévio')).toBeDisabled()
  })

  it('pousa o erro do backend no campo que ele nomeia', async () => {
    respostaDoPut = () =>
      jsonDe({ csat_expires_days: ['Prazo grande demais para um link público.'] }, 400)

    montar()
    const dias = await screen.findByLabelText('Validade do link (dias)')
    fireEvent.change(dias, { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByText('Prazo grande demais para um link público.')).toBeInTheDocument()
  })

  it('e-mail: desligar a entrega e trocar a senha do SMTP vão no PUT; senha vazia não vai', async () => {
    montar()
    const entrega = await screen.findByRole('switch', { name: 'Ligada' })
    fireEvent.click(entrega)
    fireEvent.change(screen.getByLabelText('Servidor SMTP'), { target: { value: 'smtp.acme.test' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(escritas()).toHaveLength(1))
    expect(escritas()[0]).toEqual({
      metodo: 'PUT',
      corpo: { email_enabled: false, smtp_host: 'smtp.acme.test', smtp_password: 'segredo' },
    })
  })

  it('e-mail: STARTTLS e SSL juntos são barrados antes da API', async () => {
    montar()
    await screen.findByLabelText('Servidor SMTP')
    fireEvent.click(screen.getByRole('switch', { name: 'Desligado' })) // SSL
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect(await screen.findByText('Escolha STARTTLS ou SSL, não os dois.')).toBeInTheDocument()
    await waitFor(() => expect(escritas()).toHaveLength(0))
  })

  it('e-mail de teste: POST para o endpoint com o destinatário, só sem alteração pendente', async () => {
    montar()
    const destino = await screen.findByLabelText('Destinatário do e-mail de teste')
    fireEvent.change(destino, { target: { value: 'eu@acme.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar teste' }))
    await waitFor(() => expect(escritas()).toHaveLength(1))
    expect(escritas()[0]).toEqual({ metodo: 'POST', corpo: { to: 'eu@acme.test' } })
  })

  it('não deixa salvar sem alteração nenhuma', async () => {
    montar()
    await screen.findByLabelText('Arquivos por mensagem')
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled()
  })
})
