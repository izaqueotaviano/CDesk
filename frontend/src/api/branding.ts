import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL, api } from '@/api/client'

// ---------------------------------------------------------------------------
// Marca da tela de login: os textos e a imagem do painel, por público. A
// leitura é pública (a tela de login não tem sessão); a edição é do admin,
// em Configurações → Tela de login.
// ---------------------------------------------------------------------------

export type PublicoLogin = 'cliente' | 'equipe'

export interface MarcaLogin {
  audience: PublicoLogin
  brand_name: string
  headline: string
  subtitle: string
  highlights: string[]
  /** Caminho relativo à API (`/api/v1/branding/login-image/...`) ou nulo. */
  image_url: string | null
  updated_at: string
}

export type MarcaLoginEscrita = Partial<Pick<MarcaLogin, 'brand_name' | 'headline' | 'subtitle' | 'highlights'>>

export type MarcaLoginPublica = Record<PublicoLogin, MarcaLogin>

/** O que a tela mostra se a API não responder — o mesmo padrão do backend. */
export const MARCA_PADRAO: Record<PublicoLogin, Omit<MarcaLogin, 'audience' | 'updated_at'>> = {
  cliente: {
    brand_name: 'Central de Suporte',
    headline: 'Seu suporte, no seu tempo.',
    subtitle: 'Acompanhe seus chamados, fale com a equipe e avalie o atendimento.',
    highlights: [
      'Abra chamados e acompanhe cada resposta, com prazo à vista.',
      'Converse por chat com quem atende, no horário de atendimento.',
      'Resolva sozinho com a Central de Ajuda, a qualquer hora.',
    ],
    image_url: null,
  },
  equipe: {
    brand_name: 'Resolv',
    headline: 'Tudo que a equipe precisa, num lugar só.',
    subtitle: 'A fila, o chat e os indicadores da equipe.',
    highlights: [
      'Fila de chamados com SLA, triagem e quadro por etapa.',
      'Chat em tempo real com transferência e conversão em chamado.',
      'Auditoria, LGPD e verificação em duas etapas por conta.',
    ],
    image_url: null,
  },
}

export const chaveMarcaLogin = ['branding', 'login'] as const

export function urlDaImagemDeMarca(caminho: string | null): string | null {
  return caminho ? `${API_BASE_URL}${caminho}` : null
}

/** Pública — a tela de login lê antes de existir sessão. */
export function useMarcaLogin() {
  return useQuery({
    queryKey: chaveMarcaLogin,
    queryFn: () => api.get<MarcaLoginPublica>('/api/v1/branding/login/'),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}
