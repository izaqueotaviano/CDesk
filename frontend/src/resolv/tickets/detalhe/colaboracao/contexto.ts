import { createContext, useContext } from 'react'
import type { PresenteTicket } from './usePresencaTicket'

/**
 * Os colegas presentes no ticket, para quem mora fundo na árvore (o aviso
 * acima do compositor, dentro da Conversa) sem passar prop por três camadas.
 * Quem PROVÊ é o miolo do detalhe, que é quem bate a presença. Sem provider
 * (teste isolado de um componente, portal) a lista é vazia.
 */
export const ContextoPresenca = createContext<PresenteTicket[]>([])

export function usePresentesNoTicket(): PresenteTicket[] {
  return useContext(ContextoPresenca)
}

/** "Samuel Souza" → "Samuel". O aviso cabe numa linha; o nome inteiro fica
 *  no `title` do avatar. */
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome
}

/** "Samuel", "Samuel e Ana", "Samuel, Ana e Rita", "Samuel e mais 3". */
export function juntarNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? ''
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]}`
  if (nomes.length === 3) return `${nomes[0]}, ${nomes[1]} e ${nomes[2]}`
  return `${nomes[0]} e mais ${nomes.length - 1}`
}

/** A frase do cabeçalho: quem responde primeiro (é o que colide), depois
 *  quem anota, depois quem só olha. Vazia quando não há ninguém. */
export function descreverPresenca(presentes: PresenteTicket[]): string {
  const nomesDe = (lista: PresenteTicket[]) => juntarNomes(lista.map((p) => primeiroNome(p.nome)))
  const respondendo = presentes.filter((p) => p.digitando === 'resposta')
  const anotando = presentes.filter((p) => p.digitando === 'nota')
  const vendo = presentes.filter((p) => p.digitando === null)
  const partes: string[] = []
  if (respondendo.length) {
    partes.push(`${nomesDe(respondendo)} ${respondendo.length > 1 ? 'estão' : 'está'} respondendo…`)
  }
  if (anotando.length) {
    partes.push(
      `${nomesDe(anotando)} ${anotando.length > 1 ? 'estão escrevendo notas' : 'está escrevendo uma nota'}…`,
    )
  }
  if (vendo.length) {
    partes.push(`${nomesDe(vendo)} ${vendo.length > 1 ? 'estão' : 'está'} vendo`)
  }
  return partes.join(' · ')
}
