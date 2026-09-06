import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_BASE_URL, api } from '@/api/client'
import type { Me } from '@/api/types'

// ---------------------------------------------------------------------------
// Configurações do portal: a própria conta, a empresa, os avisos por e-mail e
// a senha. Cada hook fala com um endpoint que já existia para "Minha conta"
// do lado interno — o portal só ganhou a tela.
// ---------------------------------------------------------------------------

/** O que o cliente muda no próprio perfil (`PATCH /auth/me/`). E-mail não
 *  entra: é a chave de acesso, e trocá-la é conversa com o suporte. */
export interface PerfilEscrita {
  full_name?: string
  job_title?: string
  phone?: string
}

export interface MinhaEmpresa {
  id: number
  name: string
  legal_name: string
  tax_id: string | null
  plan_name: string
  timezone: string
  account_manager_name: string | null
  contract_started_at: string | null
  /** Pessoas da empresa com acesso ao portal. */
  members: number
  domains: string[]
}

export interface EmpresaEscrita {
  legal_name?: string
  tax_id?: string | null
}

export interface PreferenciasNotificacao {
  in_app: Record<string, boolean>
  email: Record<string, boolean>
  kinds: { value: string; label: string }[]
}

/**
 * Os avisos por e-mail que chegam a um CLIENTE, com texto de quem recebe —
 * o rótulo do servidor ("Ticket novo") é o do lado interno. Os demais tipos
 * (SLA, menção, fila de chat…) são de agente e não aparecem aqui.
 */
export const AVISOS_EMAIL_CLIENTE: { kind: string; rotulo: string; descricao: string }[] = [
  {
    kind: 'ticket_created',
    rotulo: 'Abertura de chamado',
    descricao: 'Confirmação assim que um chamado é aberto — por você ou pelo suporte em seu nome.',
  },
  {
    kind: 'ticket_replied',
    rotulo: 'Resposta do suporte',
    descricao: 'Quando o suporte responde um chamado ou pede um retorno seu.',
  },
  {
    kind: 'ticket_closed',
    rotulo: 'Encerramento de chamado',
    descricao: 'Quando um chamado é resolvido, ou fechado por falta de retorno.',
  },
  {
    kind: 'chat_closed',
    rotulo: 'Chat encerrado',
    descricao: 'Ao fim de uma conversa por chat, com o lembrete de avaliação.',
  },
  {
    kind: 'chat_converted',
    rotulo: 'Conversa que virou chamado',
    descricao: 'Quando um chat não atendido continua como chamado.',
  },
]

/** Avatar como `<img src>`: o enviado mora na API, o pronto é estático do
 *  front e a foto externa já vem inteira. */
export function urlDoAvatar(caminho: string | null | undefined): string | undefined {
  if (!caminho) return undefined
  if (caminho.startsWith('http') || !caminho.startsWith('/api/')) return caminho
  return `${API_BASE_URL}${caminho}`
}

export const LIMITE_AVATAR_MB = 2

export const chavesConta = {
  empresa: ['portal', 'empresa'] as const,
  preferencias: ['notification-preferences'] as const,
}

// ---------------------------------------------------------------------------
// Perfil e avatar — toda escrita devolve o `Me` inteiro: entra direto no
// cache de ['me'], que é a fonte única de sessão do app.
// ---------------------------------------------------------------------------

function useGravarMe() {
  const qc = useQueryClient()
  return (me: Me) => qc.setQueryData(['me'], me)
}

export function useAtualizarPerfil() {
  const gravar = useGravarMe()
  return useMutation({
    mutationFn: (dados: PerfilEscrita) => api.patch<Me>('/api/v1/auth/me/', dados),
    onSuccess: gravar,
  })
}

export function useEnviarAvatar() {
  const gravar = useGravarMe()
  return useMutation({
    mutationFn: (arquivo: File) => {
      const fd = new FormData()
      fd.append('file', arquivo)
      return api.post<Me>('/api/v1/me/avatar/', fd)
    },
    onSuccess: gravar,
  })
}

export function useRemoverAvatar() {
  const gravar = useGravarMe()
  return useMutation({
    mutationFn: () => api.delete<Me>('/api/v1/me/avatar/'),
    onSuccess: gravar,
  })
}

// ---------------------------------------------------------------------------
// Empresa
// ---------------------------------------------------------------------------

export function useMinhaEmpresa() {
  return useQuery({
    queryKey: chavesConta.empresa,
    queryFn: () => api.get<MinhaEmpresa>('/api/v1/me/company/'),
    staleTime: 60_000,
  })
}

export function useAtualizarEmpresa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: EmpresaEscrita) => api.patch<MinhaEmpresa>('/api/v1/me/company/', dados),
    onSuccess: (empresa) => qc.setQueryData(chavesConta.empresa, empresa),
  })
}

// ---------------------------------------------------------------------------
// Avisos por e-mail — o PUT é parcial no servidor (só as chaves enviadas
// mudam), então cada interruptor manda só a própria chave.
// ---------------------------------------------------------------------------

export function usePreferenciasNotificacao() {
  return useQuery({
    queryKey: chavesConta.preferencias,
    queryFn: () => api.get<PreferenciasNotificacao>('/api/v1/notification-preferences/'),
    staleTime: 60_000,
  })
}

export function useSalvarPreferenciaEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, ligado }: { kind: string; ligado: boolean }) =>
      api.put<PreferenciasNotificacao>('/api/v1/notification-preferences/', { email: { [kind]: ligado } }),
    // otimista: o interruptor vira na hora; se o servidor recusar, volta
    onMutate: async ({ kind, ligado }) => {
      await qc.cancelQueries({ queryKey: chavesConta.preferencias })
      const anterior = qc.getQueryData<PreferenciasNotificacao>(chavesConta.preferencias)
      if (anterior) {
        qc.setQueryData<PreferenciasNotificacao>(chavesConta.preferencias, {
          ...anterior,
          email: { ...anterior.email, [kind]: ligado },
        })
      }
      return { anterior }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.anterior) qc.setQueryData(chavesConta.preferencias, ctx.anterior)
    },
    onSuccess: (dados) => qc.setQueryData(chavesConta.preferencias, dados),
  })
}

// ---------------------------------------------------------------------------
// Senha — a atual prova a identidade; as outras sessões continuam abertas.
// ---------------------------------------------------------------------------

export function useTrocarSenha() {
  return useMutation({
    mutationFn: (dados: { current_password: string; new_password: string }) =>
      api.post<{ detail: string }>('/api/v1/me/password/', dados),
  })
}

// ---------------------------------------------------------------------------
// Verificação em duas etapas — sempre exigida no login; o que a pessoa
// escolhe aqui é COMO recebe o código: por e-mail (padrão, sem configurar
// nada) ou por aplicativo autenticador (TOTP). Ativar o aplicativo não muda
// nada até um código válido confirmar; o segredo pendente vive na sessão.
// ---------------------------------------------------------------------------

export type Metodo2fa = '' | 'email' | 'totp'

export interface Status2fa {
  /** O que a pessoa configurou ('' = desligada). */
  method: Metodo2fa
  pending: Metodo2fa
  /** O que VALE no login: a própria escolha, ou e-mail imposto pelo admin. */
  effective: Metodo2fa
  /** O admin exige a verificação de todos (Configurações → Sistema). */
  required: boolean
}

export interface Setup2fa {
  method: Metodo2fa
  secret?: string
  otpauth_uri?: string
  sent?: boolean
}

export const chaves2fa = ['auth', '2fa', 'status'] as const

export function useStatus2fa() {
  return useQuery({
    queryKey: chaves2fa,
    queryFn: () => api.get<Status2fa>('/api/v1/auth/2fa/status/'),
    staleTime: 60_000,
  })
}

export function useIniciar2fa() {
  return useMutation({
    mutationFn: (method: 'totp' | 'email') => api.post<Setup2fa>('/api/v1/auth/2fa/setup/', { method }),
  })
}

export function useConfirmar2fa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => api.post<{ method: Metodo2fa }>('/api/v1/auth/2fa/confirm/', { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chaves2fa }),
  })
}

export function usePedirCodigoDesativar2fa() {
  return useMutation({
    mutationFn: () => api.post<{ sent: true }>('/api/v1/auth/2fa/request-code/'),
  })
}

export function useDesativar2fa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => api.post<{ method: Metodo2fa }>('/api/v1/auth/2fa/disable/', { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chaves2fa }),
  })
}

// ---------------------------------------------------------------------------
// Sessões ativas e histórico de acesso — self-service sobre a PRÓPRIA conta
// (`/me/...`, nunca um id de outro usuário na URL). Mesma forma de resposta
// que a tela do admin sobre outra pessoa (apps.accounts.sessions.
// access_history_payload) — só muda de quem é a conta.
// ---------------------------------------------------------------------------

export interface SessaoViva {
  key: string
  browser: string
  ip: string
  user_agent: string
  started_at: string | null
  expires_at: string
  current: boolean
}

export interface EventoDeAcesso {
  kind: string
  kind_label: string
  ip: string
  browser: string
  created_at: string
  success: boolean
}

export interface HistoricoDeAcesso {
  events: EventoDeAcesso[]
  logins: EventoDeAcesso[]
  sessions: SessaoViva[]
  session_limit: number
}

export const chaveHistoricoAcesso = ['auth', 'access-history'] as const

export function useMeuHistoricoAcesso() {
  return useQuery({
    queryKey: chaveHistoricoAcesso,
    queryFn: () => api.get<HistoricoDeAcesso>('/api/v1/me/access-history/'),
    staleTime: 15_000,
  })
}

export function useEncerrarSessao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => api.delete<void>(`/api/v1/me/sessions/${key}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveHistoricoAcesso }),
  })
}
