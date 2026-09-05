import { History, Home, LifeBuoy, MessageCircle, Settings, Ticket, type LucideIcon } from 'lucide-react'

export interface ItemNav {
  id: string
  rotulo: string
  /** Rótulo curto da barra inferior (celular). */
  curto?: string
  rota: string
  icone: LucideIcon
  /** `end` do NavLink: só "Início" é exato (senão fica ativo em toda rota /portal/*). */
  exato?: boolean
  /** Entra na barra inferior do celular (cinco itens; Histórico fica no menu lateral e no Início). */
  noCelular?: boolean
}

export const ITENS_NAV: ItemNav[] = [
  { id: 'inicio', rotulo: 'Início', rota: '/portal', icone: Home, exato: true, noCelular: true },
  { id: 'tickets', rotulo: 'Tickets', rota: '/portal/tickets', icone: Ticket, noCelular: true },
  { id: 'chat', rotulo: 'Chat', rota: '/portal/chat', icone: MessageCircle, noCelular: true },
  { id: 'ajuda', rotulo: 'Central de Ajuda', curto: 'Ajuda', rota: '/portal/ajuda', icone: LifeBuoy, noCelular: true },
  { id: 'historico', rotulo: 'Histórico', rota: '/portal/historico', icone: History },
  { id: 'configuracoes', rotulo: 'Configurações', curto: 'Conta', rota: '/portal/configuracoes', icone: Settings, noCelular: true },
]
