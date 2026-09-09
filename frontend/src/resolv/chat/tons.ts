import { indiceDeIdentidade, TONS_DE_IDENTIDADE, type IndiceDeIdentidade } from '@/ui/identidade'

/**
 * Um tom de identidade por atendimento ABERTO AO MESMO TEMPO, sem dois
 * iguais. Parte da cor da pessoa (o mesmo hash do avatar dela em toda tela)
 * e só desvia quando dois clientes simultâneos caem no mesmo tom — aí o de
 * id maior anda pro próximo tom livre. É o que deixa o agente com três
 * conversas abertas dizer "a azul-aço é o Bruno" sem ler o nome, e ainda
 * assim ver a mesma cor da pessoa que o resto do console mostra na maior
 * parte do tempo.
 *
 * Determinístico pelo conjunto: os mesmos chats abertos dão sempre o mesmo
 * mapa, em qualquer ordem que a lista chegue.
 */
export function tonsDistintos(chats: { id: number; client_name: string }[]): Map<number, IndiceDeIdentidade> {
  const usados = new Set<IndiceDeIdentidade>()
  const resultado = new Map<number, IndiceDeIdentidade>()
  for (const chat of [...chats].sort((a, b) => a.id - b.id)) {
    let tom = indiceDeIdentidade(chat.client_name)
    // mais de seis abertos: repete, não há como não repetir com seis tons
    for (let i = 0; i < TONS_DE_IDENTIDADE && usados.has(tom); i++) {
      tom = ((tom % TONS_DE_IDENTIDADE) + 1) as IndiceDeIdentidade
    }
    usados.add(tom)
    resultado.set(chat.id, tom)
  }
  return resultado
}
