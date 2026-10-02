import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecaoAssinatura } from './SecaoAssinatura'

const ME = '/api/v1/auth/me/'
const IMAGEM = '/api/v1/me/assinatura-imagem/'

const me = (extra: Record<string, unknown> = {}) => ({
  id: 1, email: 'sam@x.test', full_name: 'Samuel Souza', kind: 'internal', internal_role: 'agent',
  client_role: null, company: null, company_name: '', plan_name: '', is_internal: true,
  is_admin: false, teams: [], presence: 'online', permissions: [], ticket_scope: '',
  custom_role_name: '', avatar_url: '', job_title: '', phone: '', ui_density: '',
  signature: '', signature_kind: '', signature_html: '', signature_image_url: '',
  signature_render: '', ...extra,
})

let chamadas: { url: string; metodo: string; corpo: unknown }[]
let perfil: ReturnType<typeof me>

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  perfil = me()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo =
        typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body instanceof FormData ? 'multipart' : undefined
      chamadas.push({ url: u.pathname, metodo, corpo })
      if (u.pathname === ME && metodo === 'GET') return Promise.resolve(jsonDe(perfil))
      if (u.pathname === ME && metodo === 'PATCH') {
        const enviado = corpo as Record<string, string>
        // o servidor devolve o HTML higienizado — é assim que a tela sabe o
        // que sobrou (aqui, tudo o que não for <script>)
        const limpo = (enviado.signature_html ?? '').replace(/<script>.*?<\/script>/g, '')
        perfil = me({ ...enviado, signature_html: limpo, signature_render: limpo || enviado.signature })
        return Promise.resolve(jsonDe(perfil))
      }
      if (u.pathname === IMAGEM && metodo === 'POST') {
        perfil = me({ signature_kind: 'imagem', signature_image_url: '/api/v1/assinaturas/a.png', signature_render: '<img src="/api/v1/assinaturas/a.png">' })
        return Promise.resolve(jsonDe(perfil))
      }
      if (u.pathname === IMAGEM && metodo === 'DELETE') {
        perfil = me()
        return Promise.resolve(jsonDe(perfil))
      }
      return Promise.resolve(jsonDe({ detail: 'sem rota' }, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SecaoAssinatura />
    </QueryClientProvider>,
  )
}

const patch = () => chamadas.find((c) => c.metodo === 'PATCH' && c.url === ME)

describe('SecaoAssinatura', () => {
  it('começa em "Nenhuma" e o botão de salvar só acende depois de mexer', async () => {
    montar()
    const salvar = await screen.findByRole('button', { name: 'Salvar assinatura' })
    expect(salvar).toBeDisabled()
    expect(screen.getByText(/Sem assinatura/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Texto' }))
    fireEvent.change(screen.getByLabelText('Texto da assinatura'), { target: { value: 'Samuel — Suporte' } })
    expect(salvar).toBeEnabled()
  })

  it('salva o texto com a forma escolhida', async () => {
    montar()
    await screen.findByRole('button', { name: 'Salvar assinatura' })
    fireEvent.click(screen.getByRole('radio', { name: 'Texto' }))
    fireEvent.change(screen.getByLabelText('Texto da assinatura'), { target: { value: 'Samuel — Suporte' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar assinatura' }))

    await waitFor(() => expect(patch()).toBeTruthy())
    expect(patch()!.corpo).toEqual({
      signature_kind: 'texto',
      signature: 'Samuel — Suporte',
      signature_html: '',
    })
    // a prévia passa a mostrar o que o servidor devolveu (o textarea também
    // tem o texto — por isso a busca é dentro da prévia)
    const previa = await screen.findByText('Prévia')
    await waitFor(() =>
      expect(previa.parentElement!.textContent).toContain('Samuel — Suporte'),
    )
  })

  it('HTML: avisa quando o servidor tirou parte, e a prévia mostra o que sobrou', async () => {
    montar()
    await screen.findByRole('button', { name: 'Salvar assinatura' })
    fireEvent.click(screen.getByRole('radio', { name: 'HTML' }))
    fireEvent.change(screen.getByLabelText('HTML da assinatura'), {
      target: { value: '<p>Samuel</p><script>alert(1)</script>' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar assinatura' }))

    expect(await screen.findByText('Tirei parte do HTML')).toBeInTheDocument()
    // o campo passa a mostrar o HTML higienizado, não o que foi digitado
    await waitFor(() =>
      expect(screen.getByLabelText('HTML da assinatura')).toHaveValue('<p>Samuel</p>'),
    )
  })

  it('HTML aceito inteiro não gera aviso', async () => {
    montar()
    await screen.findByRole('button', { name: 'Salvar assinatura' })
    fireEvent.click(screen.getByRole('radio', { name: 'HTML' }))
    fireEvent.change(screen.getByLabelText('HTML da assinatura'), { target: { value: '<p>Samuel</p>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar assinatura' }))
    await waitFor(() => expect(patch()).toBeTruthy())
    expect(screen.queryByText('Tirei parte do HTML')).not.toBeInTheDocument()
  })

  it('imagem: envia o arquivo e o servidor é quem liga a forma', async () => {
    montar()
    await screen.findByRole('button', { name: 'Salvar assinatura' })
    fireEvent.click(screen.getByRole('radio', { name: 'Imagem' }))
    const arquivo = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [arquivo] } })

    await waitFor(() => expect(chamadas.some((c) => c.url === IMAGEM && c.metodo === 'POST')).toBe(true))
    expect(await screen.findByRole('button', { name: /Trocar imagem/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remover/ })).toBeInTheDocument()
  })

  it('imagem grande demais nem sobe — o erro vem antes da rede', async () => {
    montar()
    await screen.findByRole('button', { name: 'Salvar assinatura' })
    fireEvent.click(screen.getByRole('radio', { name: 'Imagem' }))
    const grande = new File([new Uint8Array(2 * 1024 * 1024)], 'logo.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [grande] } })

    await waitFor(() =>
      expect(chamadas.some((c) => c.url === IMAGEM && c.metodo === 'POST')).toBe(false),
    )
  })

  it('quem já tem assinatura abre na forma dela, sem precisar reconfigurar', async () => {
    perfil = me({ signature_kind: 'html', signature_html: '<p>Oi</p>', signature_render: '<p>Oi</p>' })
    montar()
    expect(await screen.findByLabelText('HTML da assinatura')).toHaveValue('<p>Oi</p>')
    expect(screen.getByRole('radio', { name: 'HTML' })).toBeChecked()
  })
})
