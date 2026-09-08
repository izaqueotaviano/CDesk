import { IconHistory, IconHome, IconLifebuoy, IconMessageCircle, IconSettings, IconTicket, type Icon } from '@tabler/icons-react'

export interface ItemNav {
  id: string
  rotulo: string
  /** Rótulo curto da barra inferior (celular). */
  curto?: string
  rota: string
  icone: Icon
  /** `end` do NavLink: só "Início" é exato (senão fica ativo em toda rota /portal/*). */
  exato?: boolean
  /** Entra na barra inferior do celular (cinco itens; Histórico fica no menu lateral e no Início). */
  noCelular?: boolean
}

// Ícones Tabler — a mesma família (`ti ti-*`) que o console usa na sidebar
// (resolv/shell/Sidebar.tsx): home, ticket, message-circle, settings…
export const ITENS_NAV: ItemNav[] = [
  { id: 'inicio', rotulo: 'Início', rota: '/portal', icone: IconHome, exato: true, noCelular: true },
  { id: 'tickets', rotulo: 'Tickets', rota: '/portal/tickets', icone: IconTicket, noCelular: true },
  { id: 'chat', rotulo: 'Chat', rota: '/portal/chat', icone: IconMessageCircle, noCelular: true },
  { id: 'ajuda', rotulo: 'Central de Ajuda', curto: 'Ajuda', rota: '/portal/ajuda', icone: IconLifebuoy, noCelular: true },
  { id: 'historico', rotulo: 'Histórico', rota: '/portal/historico', icone: IconHistory },
  { id: 'configuracoes', rotulo: 'Configurações', curto: 'Conta', rota: '/portal/configuracoes', icone: IconSettings, noCelular: true },
]
