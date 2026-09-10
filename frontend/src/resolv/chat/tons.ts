import { indiceEmModulo } from '@/ui/identidade'

/**
 * Paleta de identidade SÓ do chat — 15 tons (`--chat-tom-1`..`--chat-tom-15`,
 * resolv/styles/tokens.scss), não os 6 de `ui/identidade.ts`. Aquele hash
 * pinta o produto inteiro (cartão do quadro, painel do cliente, gráfico de
 * categoria); usá-lo aqui também faria qualquer ajuste de paleta do chat
 * mexer em telas que não têm nada a ver com atendimento. Mesmo algoritmo
 * (`indiceEmModulo`), pool à parte.
 */
export const TONS_DE_CHAT = 15

export type IndiceDeChat =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15

/** O tom de BASE de uma pessoa, pelo nome — o que o cabeçalho da conversa
 *  cheia e o avatar de cada mensagem usam. Determinístico: o mesmo nome cai
 *  sempre no mesmo tom, em qualquer tela do chat. */
export function indiceDeChat(chave: string): IndiceDeChat {
  return indiceEmModulo(chave, TONS_DE_CHAT) as IndiceDeChat
}

/** Atributo pronto pra espalhar num elemento — `{...tomDeChat(nome)}` — no
 *  mesmo formato de `identidadeDe` (ui/identidade.ts), só que na paleta do
 *  chat. Quem pinta é o CSS pelo atributo (chat.scss). */
export function tomDeChat(chave: string): { 'data-tom-chat': IndiceDeChat } {
  return { 'data-tom-chat': indiceDeChat(chave) }
}

/**
 * Um tom da paleta do chat por atendimento ABERTO AO MESMO TEMPO, sem dois
 * iguais. Parte da cor da pessoa (o mesmo hash do avatar dela em todo o
 * chat) e só desvia quando dois clientes simultâneos caem no mesmo tom — aí
 * o de id maior anda pro próximo tom livre. É o que deixa o agente com
 * várias conversas abertas dizer "a azul-aço é o Bruno" sem ler o nome, e
 * ainda assim ver a mesma cor da pessoa que o resto do chat mostra na maior
 * parte do tempo.
 *
 * Com 15 tons em vez de 6, a colisão fica bem mais rara — antes, três
 * atendimentos simultâneos já podiam repetir cor.
 *
 * Determinístico pelo conjunto: os mesmos chats abertos dão sempre o mesmo
 * mapa, em qualquer ordem que a lista chegue.
 */
export function tonsDistintos(chats: { id: number; client_name: string }[]): Map<number, IndiceDeChat> {
  const usados = new Set<IndiceDeChat>()
  const resultado = new Map<number, IndiceDeChat>()
  for (const chat of [...chats].sort((a, b) => a.id - b.id)) {
    let tom = indiceDeChat(chat.client_name)
    // mais que os tons disponíveis abertos: repete, não há como não repetir
    for (let i = 0; i < TONS_DE_CHAT && usados.has(tom); i++) {
      tom = ((tom % TONS_DE_CHAT) + 1) as IndiceDeChat
    }
    usados.add(tom)
    resultado.set(chat.id, tom)
  }
  return resultado
}
