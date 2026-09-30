import { IconHeadset, IconLifebuoy, IconShieldCheck, IconTicket, type Icon } from '@tabler/icons-react'
import { MARCA_PADRAO, useMarcaLogin, type MarcaLogin, type PublicoLogin } from '@/api/branding'

// O que as telas sem sessão sabem de cada público (equipe e cliente).
// Fora de LayoutLogin.tsx para o arquivo do componente só exportar
// componente (o fast refresh do Vite depende disso).

/** O que é fixo por público. Os textos e a imagem do painel vêm da marca
 *  configurada pelo admin (Configurações → Tela de login). */
export interface PublicoDoLogin {
  publico: PublicoLogin
  rotaLogin: string
  rotaEsqueci: string
  /** Ícones dos destaques do painel, na ordem em que o admin os escreve. */
  icones: Icon[]
  placeholderEmail: string
  outroPublico: { pergunta: string; acao: string; rota: string }
}

export const PUBLICOS: Record<PublicoLogin, PublicoDoLogin> = {
  cliente: {
    publico: 'cliente',
    rotaLogin: '/login/cliente',
    rotaEsqueci: '/login/cliente/esqueci-senha',
    icones: [IconTicket, IconHeadset, IconLifebuoy],
    placeholderEmail: 'voce@suaempresa.com.br',
    outroPublico: { pergunta: 'É da equipe de suporte?', acao: 'Entrar no painel', rota: '/login' },
  },
  equipe: {
    publico: 'equipe',
    rotaLogin: '/login',
    rotaEsqueci: '/login/esqueci-senha',
    icones: [IconTicket, IconHeadset, IconShieldCheck],
    placeholderEmail: 'voce@empresa.com.br',
    outroPublico: { pergunta: 'É cliente?', acao: 'Acessar o portal', rota: '/login/cliente' },
  },
}

/** O público de uma rota: tudo sob `/login/cliente` e o convite do portal
 *  são do cliente; o resto é da equipe. */
export function publicoDaRota(pathname: string): PublicoLogin {
  return pathname.startsWith('/login/cliente') || pathname.startsWith('/portal/') ? 'cliente' : 'equipe'
}

export type Marca = Omit<MarcaLogin, 'audience' | 'updated_at'>

/** Textos e imagem do painel: do admin, ou o padrão se a API não responder;
 *  enquanto carrega, `null` — o painel fica sem texto para não piscar o
 *  padrão antes do configurado. */
export function useMarcaDoPublico(publico: PublicoLogin): Marca | null {
  const marcaQuery = useMarcaLogin()
  if (marcaQuery.data) return marcaQuery.data[publico]
  return marcaQuery.isError ? MARCA_PADRAO[publico] : null
}
