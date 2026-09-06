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
 *     (validação), às vezes com `code` legível.
 */

// Exportada: campos como `avatar_url` chegam do backend como caminho relativo
// (`/avatars/...`, `/media/...`) — quem for montar um <img src> a partir
// deles precisa desta mesma base, senão o navegador resolve contra a origem
// do Vite (5174) em vez da API (8000) e o avatar 404.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

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
