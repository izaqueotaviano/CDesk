import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'
import { chaves, type Chat } from '@/api/chat'

/**
 * Macro aplicável no console de chat — MESMA tabela `TicketMacro` do
 * backend que o chamado usa (apps/tickets/models.py: "cadastro ÚNICO,
 * usado no chamado E no chat"), não um cadastro à parte. `chat_name` só
 * tem efeito aqui (nomeia a conversa); no chamado o backend ignora.
 */
export interface Macro {
  id: number
  name: string
  body: string
  chat_name?: string
  category?: number | null
  category_name?: string | null
  priority?: string | null
  assignee?: number | null
  assignee_name?: string | null
  tags?: number[]
  is_active?: boolean
}

/**
 * Lista de macros para o menu "Aplicar macro…" do compositor de chat.
 * Mesmo endpoint que `resolv/tickets/detalhe/dados.ts` usa (`useMacros`) —
 * mas com chave de cache PRÓPRIA (`chat-macros`), porque esta pasta não
 * importa de `resolv/tickets` (features diferentes, cada uma dona da
 * própria pasta). `?limit=200`: o backend pagina em 25 por padrão
 * (PAGE_SIZE, config/settings/base.py), e uma empresa com mais macros que
 * isso não pode perder as demais em silêncio.
 */
export function useMacros() {
  return useQuery({
    queryKey: ['chat-macros'],
    queryFn: () =>
      api.get<Paginado<Macro> | Macro[]>('/api/v1/settings/ticket-macros/?limit=200'),
    staleTime: 300_000,
    select: (d) => (Array.isArray(d) ? d : d.results).filter((m) => m.is_active !== false),
  })
}

/**
 * Aplica a macro NO CHAT: grava no servidor os campos de atendimento que
 * ela carrega (nome da conversa, categoria, prioridade, responsável,
 * etiquetas — `chat_service.apply_macro`, soma e não zera). O texto pronto
 * é responsabilidade do compositor (`ConversaChat.usarMacro`), igual ao
 * chamado — esta chamada nunca manda mensagem nenhuma.
 */
export function useAplicarMacroChat(chatId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (macro_id: number) =>
      api.post<Chat>(`/api/v1/chat/chats/${chatId}/apply-macro/`, { macro_id }),
    onSuccess: (chat) => qc.setQueryData(chaves.chat(chatId), chat),
  })
}
