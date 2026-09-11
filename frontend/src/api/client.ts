/**
 * Cliente HTTP para a API do Resolv.
 *
 * Contrato inteiro documentado em docs/10-frontend-novo.md (verificado contra
 * a API rodando, não escrito de memória — vale reler antes de mexer aqui):
 *
 *   - Sessão em COOKIE, não JWT. A verificação em duas etapas é opcional por
 *     conta (`portal/api/conta.ts`): quem a tem ligada passa por uma sessão
 *     PENDENTE até o POST /auth/2fa/; quem não tem, a senha certa já cria a
 *     sessão autenticada (e o cookie csrftoken aparece) na hora.
 *   - Sem sessão válida, toda view autenticada devolve 401 de verdade
 *     (`apps.core.authentication.SessionAuthenticationComCabecalho`) — é o
 *     que `aoDeslogar` escuta abaixo. 403 continua sendo "autenticado, mas
 *     sem permissão para isto".
 *   - Toda chamada precisa de `credentials: 'include'` — backend e frontend
 *     são origens diferentes (CORS com credenciais, não proxy same-origin).
 *   - Toda escrita autenticada (POST/PUT/PATCH/DELETE) exige o header
 *     `X-CSRFToken` com o valor do cookie `csrftoken`. Esquecer o header dá
 *     403 — inclusive no logout, que é onde isso costuma ser notado tarde.
 *   - Paginação: LimitOffsetPagination, 25/página,
 *     `{count, next, previous, results}`.
 *   - Erro: `{"detail": "..."}` (geral) ou `{"campo": ["mensagem"]}`
 *     (validação — a view que valida na mão manda `{"campo": "mensagem"}`,
 *     string crua, sem lista), às vezes com `code` legível.
 */

// Exportada: campos como `avatar_url` chegam do backend como caminho relativo
// (`/avatars/...`, `/media/...`) — quem for montar um <img src> a partir
// deles precisa desta mesma base, senão o navegador resolve contra a origem
// do Vite (5174) em vez da API (8000) e o avatar 404.
//
// Sem a variável, o build de PRODUÇÃO usa a própria origem ('' → URL relativa:
// `/api/v1/...`), que é o que o nginx de deploy/ espera — `/api/` e `/ws/`
// no mesmo host da SPA. O `localhost:8000` só vale no dev server do Vite
// (porta 5173, API em outra porta). Antes o fallback era localhost SEMPRE, e
// um build sem `.env.production` saía apontando pra máquina de quem buildou.
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:8000' : '')

export class ApiError extends Error {
  status: number
  detail?: string
  code?: string
  /** Erros de validação por campo, SEMPRE em lista — mesmo quando o backend
   *  mandou a mensagem solta (ver a normalização no construtor). */
  fieldErrors?: Record<string, string[]>

  constructor(status: number, body: unknown) {
    // Lista de fora de propósito: `ValidationError("msg")` numa view vira o
    // corpo `["msg"]`, e ler isso como registro inventaria "erro do campo 0".
    const asRecord =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {}
    const detail = typeof asRecord.detail === 'string' ? asRecord.detail : undefined
    super(detail ?? `Erro ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.code = typeof asRecord.code === 'string' ? asRecord.code : undefined

    // O erro de campo chega de DUAS formas: lista quando nasce no serializer
    // (`{"email": ["obrigatório"]}`) e string crua quando a view valida na
    // mão — `{"requester_id": "Cliente não encontrado."}` e `{"files": "..."}`
    // em apps/tickets/views.py. Só a lista era colhida, então o motivo real
    // do 400 (anexo recusado, cliente desativado) sumia e a tela mostrava
    // "Erro 400". A string vira lista de um item aqui, e não em cada tela.
    //
    // `code` no corpo marca envelope montado à mão pela view (`detail` +
    // `code` + dados de apoio), não validação: o 422 de cota
    // (apps/tickets/views.py:391) manda `used`/`limit`/`renews_at` junto, e
    // `renews_at` é string — normalizar às cegas criaria um "erro do campo
    // renews_at" que nenhum formulário tem. Nesses corpos as chaves extras
    // são dado para a tela; a lista continua entrando porque
    // `pendentesDoErro` (api/chat.ts) lê `pending_ratings` daqui.
    const { detail: _d, code: _c, ...resto } = asRecord
    const ehEnvelopeDaView = this.code !== undefined
    const fieldErrors = Object.fromEntries(
      Object.entries(resto)
        .filter(([, v]) => Array.isArray(v) || (!ehEnvelopeDaView && typeof v === 'string'))
        .map(([campo, v]) => [campo, typeof v === 'string' ? [v] : v]),
    ) as Record<string, string[]>
    if (Object.keys(fieldErrors).length > 0) this.fieldErrors = fieldErrors
  }
}

/** Lido do cookie a cada escrita — nunca guardado em variável (expira/rotaciona). */
function lerCsrfToken(): string | null {
  return document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1] ?? null
}

/** Handlers globais (ex.: limpar cache e redirecionar) — setados por main.tsx.
 *  Fica aqui, e não num import circular de useQueryClient, porque este módulo
 *  não pode depender de React: é usado também por realtime/socket.ts. */
let aoReceber401: (() => void) | null = null
export function aoDeslogar(handler: () => void) {
  aoReceber401 = handler
}

interface Opcoes extends Omit<RequestInit, 'body'> {
  body?: unknown
}

async function requisitar<T>(path: string, opcoes: Opcoes = {}): Promise<T> {
  const { body, headers, method = 'GET', ...resto } = opcoes
  const precisaCsrf = method !== 'GET' && method !== 'HEAD'
  const ehFormData = typeof FormData !== 'undefined' && body instanceof FormData

  const resp = await fetch(`${API_BASE_URL}${path}`, {
    ...resto,
    method,
    credentials: 'include', // sessão vai no cookie
    headers: {
      // FormData: NÃO fixar Content-Type — o browser põe o boundary do
      // multipart sozinho (usado no reply com anexos).
      ...(body !== undefined && !ehFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(precisaCsrf ? { 'X-CSRFToken': lerCsrfToken() ?? '' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : ehFormData ? (body as FormData) : JSON.stringify(body),
  })

  // `/auth/me/` fica de fora: `RotaProtegida` já trata o 401 dela sozinha
  // (e sabe se manda para /login ou /login/cliente, o que este handler
  // global não sabe). Disparar os dois pro mesmo 401 mandaria a pessoa pro
  // login errado quando o portal expira.
  if (resp.status === 401 && !path.endsWith('/auth/me/')) {
    aoReceber401?.()
  }

  if (resp.status === 204) return undefined as T

  const contentType = resp.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await resp.json() : await resp.text()

  if (!resp.ok) throw new ApiError(resp.status, payload)
  return payload as T
}

/**
 * POST multipart COM progresso e cancelamento.
 *
 * XMLHttpRequest e não `fetch` por um motivo só: `fetch` não expõe progresso
 * de UPLOAD. Sem isto, anexar um arquivo de 8 MB é uma barra que não existe e
 * um botão que fica cinza por trinta segundos — a pessoa clica de novo e manda
 * duas vezes. O resto (cookie de sessão, CSRF, ApiError) segue igual ao
 * `requisitar`, de propósito: quem chama trata erro do mesmo jeito.
 */
export function enviarComProgresso<T>(
  path: string,
  form: FormData,
  opcoes: { onProgresso?: (fracao: number) => void; signal?: AbortSignal } = {},
): Promise<T> {
  const { onProgresso, signal } = opcoes
  return new Promise<T>((resolver, rejeitar) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}${path}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('X-CSRFToken', lerCsrfToken() ?? '')

    xhr.upload.onprogress = (e) => {
      // `lengthComputable` falso acontece de verdade (proxy sem
      // Content-Length): melhor não mostrar barra nenhuma do que mostrar uma
      // barra que anda sozinha sem relação com o arquivo.
      if (e.lengthComputable && e.total > 0) onProgresso?.(e.loaded / e.total)
    }

    xhr.onload = () => {
      const tipo = xhr.getResponseHeader('content-type') ?? ''
      const corpo = tipo.includes('application/json')
        ? (JSON.parse(xhr.responseText || 'null') as unknown)
        : xhr.responseText
      if (xhr.status === 401 && !path.endsWith('/auth/me/')) aoReceber401?.()
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgresso?.(1)
        resolver(corpo as T)
      } else {
        rejeitar(new ApiError(xhr.status, corpo))
      }
    }
    // Rede caída e cancelamento são coisas DIFERENTES para quem olha a tela:
    // uma oferece "tentar de novo", a outra já é a decisão da pessoa.
    xhr.onerror = () => rejeitar(new ApiError(0, { detail: 'Falha de conexão ao enviar.' }))
    xhr.onabort = () => rejeitar(new DOMException('Envio cancelado.', 'AbortError'))

    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    if (signal?.aborted) {
      xhr.abort()
      return
    }
    xhr.send(form)
  })
}

export const api = {
  get: <T>(path: string, opcoes?: Opcoes) => requisitar<T>(path, { ...opcoes, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opcoes?: Opcoes) =>
    requisitar<T>(path, { ...opcoes, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opcoes?: Opcoes) =>
    requisitar<T>(path, { ...opcoes, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opcoes?: Opcoes) =>
    requisitar<T>(path, { ...opcoes, method: 'PATCH', body }),
  delete: <T>(path: string, opcoes?: Opcoes) => requisitar<T>(path, { ...opcoes, method: 'DELETE' }),
}

/** Envelope de paginação — LimitOffsetPagination, 25/página. */
export interface Paginado<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
