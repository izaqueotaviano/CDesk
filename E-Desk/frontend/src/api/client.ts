/**
 * Cliente HTTP para a API do Resolv.
 *
 * Contrato inteiro documentado em docs/10-frontend-novo.md (verificado contra
 * a API rodando, não escrito de memória — vale reler antes de mexer aqui):
 *
 *   - Sessão em COOKIE, não JWT. 2FA obrigatório: login só cria sessão
 *     PENDENTE; a sessão vira autenticada (e o cookie csrftoken aparece)
 *     só depois do POST /auth/2fa/.
 *   - Toda chamada precisa de `credentials: 'include'` — backend e frontend
 *     são origens diferentes (CORS com credenciais, não proxy same-origin).
 *   - Toda escrita autenticada (POST/PUT/PATCH/DELETE) exige o header
 *     `X-CSRFToken` com o valor do cookie `csrftoken`. Esquecer o header dá
 *     403 — inclusive no logout, que é onde isso costuma ser notado tarde.
 *   - Paginação: LimitOffsetPagination, 25/página,
 *     `{count, next, previous, results}`.
 *   - Erro: `{"detail": "..."}` (geral) ou `{"campo": ["mensagem"]}`
 *     (validação), às vezes com `code` legível.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
  status: number
  detail?: string
  code?: string
  /** Erros de validação por campo: `{"email": ["obrigatório"]}`. */
  fieldErrors?: Record<string, string[]>

  constructor(status: number, body: unknown) {
    const asRecord = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    const detail = typeof asRecord.detail === 'string' ? asRecord.detail : undefined
    super(detail ?? `Erro ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.code = typeof asRecord.code === 'string' ? asRecord.code : undefined

    const { detail: _d, code: _c, ...rest } = asRecord
    const fieldErrors = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => Array.isArray(v)),
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

  if (resp.status === 401) {
    aoReceber401?.()
  }

  if (resp.status === 204) return undefined as T

  const contentType = resp.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await resp.json() : await resp.text()

  if (!resp.ok) throw new ApiError(resp.status, payload)
  return payload as T
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
