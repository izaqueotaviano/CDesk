/**
 * Tipos escritos à mão para o que a base já consome (auth, abas).
 *
 * Isto é ponte, não destino: assim que alguém rodar `npm run generate:api`
 * (openapi-typescript sobre resolv-openapi.yaml — docs/10-frontend-novo.md),
 * troque os usos abaixo pelos tipos gerados em `schema.d.ts` e apague este
 * arquivo. Os nomes de campo e enums aqui foram conferidos contra o schema
 * (`components.schemas.Me`), não escritos de memória.
 */

export type UserKind = 'internal' | 'client'
export type InternalRole = 'admin' | 'supervisor' | 'agent' | 'light_agent'
export type ClientRole = 'owner' | 'member'
export type Presence = 'available' | 'away' | 'offline'
export type UiDensity = 'comfortable' | 'compact' | ''

export interface Me {
  id: number
  email: string
  full_name: string
  kind: UserKind
  internal_role: InternalRole | '' | null
  client_role: ClientRole | '' | null
  company: number | null
  company_name: string
  plan_name: string
  is_internal: boolean
  is_admin: boolean
  teams: string[]
  presence: Presence
  permissions: string[]
  ticket_scope: string
  custom_role_name: string
  avatar_url: string
  /** Cargo e telefone — o que a pessoa edita em Configurações. */
  job_title: string
  phone: string
  ui_density: UiDensity
  /** Assinatura do rodapé das respostas, em uma de três formas. O conteúdo
   *  NÃO é copiado para o corpo da mensagem: `signature_render` é o bloco
   *  pronto (já higienizado pelo servidor) que a prévia e a conversa
   *  desenham. Ver apps/accounts/assinatura.py. */
  signature: string
  signature_kind: '' | 'texto' | 'html' | 'imagem'
  signature_html: string
  signature_image_url: string
  signature_render: string
  /** Só para cliente: uso da cota de chamados no período corrente. */
  quota?: { used: number; limit: number | null; period_start: string; period_end: string }
}

/** Resposta do passo 1 do login (docs/10-frontend-novo.md §"Autenticação"). */
export interface LoginPendente {
  two_factor: 'email' | 'totp'
}
