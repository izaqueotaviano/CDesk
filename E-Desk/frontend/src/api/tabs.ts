import { api } from '@/api/client'

/**
 * Resumo do ticket como ele vem HIDRATADO dentro da resposta de /tickets/tabs/
 * (docs/06-abas-frontend.md: "a SPA restaura a TabBar com um único request,
 * sem N chamadas de detalhe"). Campos reduzidos ao que uma aba mostra —
 * troque por `TicketList` de schema.d.ts assim que `npm run generate:api`
 * rodar.
 *
 * Nota: o resolv-openapi.yaml atual anuncia esse endpoint devolvendo
 * `TicketList` puro (não `{tabs, active_ticket_id}`) e ainda com um parâmetro
 * de path `id` que não faz sentido numa rota de coleção — parece artefato de
 * geração do schema, não o contrato real (a prosa de docs/06 e docs/07, com
 * exemplo de payload e teste nomeado, é mais específica e é o que a suíte do
 * backend cobre). Vale confirmar com o backend antes de generate:api virar a
 * fonte de tipos aqui.
 */
export interface TicketResumo {
  id: number
  reference: string
  subject: string
  status: string
  stage_color?: string | null
  requester_display: string
  /** Título da aba no design system Resolv (o print mostra a empresa). O GET
   *  /tickets/tabs/ hidrata com o TicketList inteiro, então este campo já vem. */
  company_name?: string
}

export interface EstadoAbasServidor {
  tabs: TicketResumo[]
  active_ticket_id: number | null
}

export function getTabsServidor() {
  return api.get<EstadoAbasServidor>('/api/v1/tickets/tabs/')
}

export function putTabsServidor(dados: { ticket_ids: number[]; active_ticket_id: number | null }) {
  return api.put<EstadoAbasServidor>('/api/v1/tickets/tabs/', dados)
}
