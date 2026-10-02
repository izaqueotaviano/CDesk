import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { chavesConta, type PreferenciasNotificacao } from '@/portal/api/conta'

export type Canal = 'in_app' | 'email'

export interface AvisoDoAgente {
  kind: string
  rotulo: string
  descricao: string
  /** O backend manda e-mail deste tipo para quem ATENDE? Onde não manda
   *  (chamado novo na equipe, resposta do cliente), a coluna de e-mail
   *  mostra um traço em vez de uma chave que não faria nada. Conferido
   *  contra cada `quer_email(...)` em apps/. */
  email: boolean
  /** Só administradores recebem (prazo de pedido LGPD). */
  soAdmin?: boolean
}

/**
 * Os tipos de aviso que chegam a quem atende, na ordem em que a pessoa
 * pensa neles: primeiro o que é SEU (atribuído, respondido, citado), depois
 * prazo, fila e o resto. O rótulo é o de quem recebe, não o do servidor
 * ("Ticket respondido" diz pouco; "Resposta do cliente" diz o que chegou).
 * Os tipos só de cliente (encerramento, chat encerrado) não aparecem.
 */
export const GRUPOS_DE_AVISOS: { titulo: string; avisos: AvisoDoAgente[] }[] = [
  {
    titulo: 'Tickets',
    avisos: [
      { kind: 'ticket_assigned', rotulo: 'Ticket atribuído a você', descricao: 'Quando alguém passa um ticket para você.', email: true },
      { kind: 'ticket_replied', rotulo: 'Resposta do cliente', descricao: 'Quando o cliente responde um ticket seu.', email: false },
      { kind: 'mention', rotulo: 'Menção', descricao: 'Quando alguém cita você numa nota interna.', email: true },
      { kind: 'ticket_reopened', rotulo: 'Ticket reaberto', descricao: 'Quando o cliente volta a escrever num ticket seu já fechado.', email: true },
      { kind: 'ticket_owner_set', rotulo: 'Dono técnico', descricao: 'Quando você passa a ser o dono técnico de um ticket.', email: true },
      { kind: 'ticket_created', rotulo: 'Ticket novo na sua equipe', descricao: 'Quando um cliente abre um ticket para uma equipe sua.', email: false },
    ],
  },
  {
    titulo: 'Prazos',
    avisos: [
      { kind: 'sla_warning', rotulo: 'SLA em risco', descricao: 'Quando o prazo de um ticket seu está perto do fim.', email: true },
      { kind: 'sla_breached', rotulo: 'SLA estourado', descricao: 'Quando o prazo de um ticket seu passou.', email: true },
      { kind: 'kanban_due', rotulo: 'Prazo do quadro', descricao: 'Quando vence o prazo de um card seu no quadro.', email: true },
    ],
  },
  {
    titulo: 'Conversas e avisos',
    avisos: [
      { kind: 'chat_incoming', rotulo: 'Chat esperando na fila', descricao: 'Quando uma conversa espera na fila mais que o normal.', email: true },
      { kind: 'announcement', rotulo: 'Avisos da equipe', descricao: 'Comunicados publicados pela administração.', email: true },
      { kind: 'attachment_blocked', rotulo: 'Anexo bloqueado', descricao: 'Quando o antivírus barra um arquivo que você enviou.', email: true },
      { kind: 'lgpd_deadline', rotulo: 'Prazo de pedido LGPD', descricao: 'Pedidos de titulares perto do prazo legal.', email: true, soAdmin: true },
    ],
  },
]

/**
 * Liga/desliga UM tipo num canal. O PUT do servidor é parcial (só as chaves
 * enviadas mudam), então cada chave manda só a si mesma — duas mudanças
 * seguidas não se atropelam. Otimista, como no portal: a chave vira na hora
 * e volta se o servidor recusar. Mesmo cache (`chavesConta.preferencias`)
 * que a tela do portal usa.
 */
export function useSalvarPreferenciaDeAviso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ canal, kind, ligado }: { canal: Canal; kind: string; ligado: boolean }) =>
      api.put<PreferenciasNotificacao>('/api/v1/notification-preferences/', { [canal]: { [kind]: ligado } }),
    onMutate: async ({ canal, kind, ligado }) => {
      await qc.cancelQueries({ queryKey: chavesConta.preferencias })
      const anterior = qc.getQueryData<PreferenciasNotificacao>(chavesConta.preferencias)
      if (anterior) {
        qc.setQueryData<PreferenciasNotificacao>(chavesConta.preferencias, {
          ...anterior,
          [canal]: { ...anterior[canal], [kind]: ligado },
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
