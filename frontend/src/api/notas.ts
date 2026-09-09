import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'

/**
 * Notas pessoais (`apps/notes`) — a camada compartilhada.
 *
 * Mora em `api/` e não dentro de uma tela porque tem DOIS consumidores: o
 * painel de notas do detalhe do chamado e a página `/notas`. Os dois falam
 * com os mesmos endpoints e precisam invalidar o mesmo cache — se cada um
 * tivesse a sua cópia, escrever uma nota pelo chamado deixaria a página
 * `/notas` mostrando o estado velho.
 *
 * A nota é PRIVADA de quem está logado: o backend recorta por dono
 * (`apps/notes/selectors.visible_notes`) e nota de outra pessoa responde 404.
 * Nada aqui filtra nada — não há o que esconder na tela.
 */

export interface Etiqueta {
  id: number
  name: string
  slug: string
}

/** A linha da lista: sem o corpo inteiro, só o trecho que a prévia desenha. */
export interface NotaResumo {
  id: number
  title: string
  excerpt: string
  tags: Etiqueta[]
  ticket: number | null
  /** `null` quando o chamado saiu do escopo de quem lê — o id fica, o resto some. */
  ticket_reference: string | null
  ticket_subject: string | null
  is_pinned: boolean
  is_archived: boolean
  is_deleted: boolean
  created_at: string
  updated_at: string
}

/** A nota aberta: o resumo mais o corpo. */
export interface Nota extends NotaResumo {
  content: string
}

export type EstadoNota = 'active' | 'archived' | 'pinned' | 'trash'

export interface FiltroNotas {
  state?: EstadoNota
  q?: string
  tag?: string
  ticket?: number
}

/** O que a escrita aceita. `owner` não entra: o dono é a sessão. */
export interface EntradaNota {
  title?: string
  content?: string
  ticket?: number | null
  is_pinned?: boolean
  is_archived?: boolean
  /**
   * Etiquetas por NOME digitado. Ausente ≠ lista vazia: o backend só mexe nas
   * etiquetas de quem mandou o campo, para o autosave (que manda PATCH
   * parcial a cada pausa) não limpá-las ao salvar só o título.
   */
  tag_names?: string[]
}

const BASE = '/api/v1/notes/'

/** Raiz de todo cache de nota — invalidar aqui alcança lista, filtro e detalhe. */
export const chaveNotas = ['notas'] as const
export const chaveListaNotas = (filtro: FiltroNotas = {}) => ['notas', 'lista', filtro] as const
export const chaveNota = (id: number) => ['notas', 'item', id] as const
export const chaveEtiquetas = ['notas', 'etiquetas'] as const

function querystring(filtro: FiltroNotas): string {
  const p = new URLSearchParams()
  if (filtro.state) p.set('state', filtro.state)
  if (filtro.q) p.set('q', filtro.q)
  if (filtro.tag) p.set('tag', filtro.tag)
  if (filtro.ticket != null) p.set('ticket', String(filtro.ticket))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function useNotas(filtro: FiltroNotas = {}, opcoes: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: chaveListaNotas(filtro),
    queryFn: () => api.get<Paginado<NotaResumo>>(`${BASE}${querystring(filtro)}`),
    staleTime: 10_000,
    enabled: opcoes.enabled ?? true,
  })
}

/** O corpo inteiro de uma nota — a lista devolve só o trecho. */
export function useNota(id: number | null) {
  return useQuery({
    queryKey: chaveNota(id ?? 0),
    queryFn: () => api.get<Nota>(`${BASE}${id}/`),
    enabled: id != null,
    staleTime: 10_000,
  })
}

/** Etiquetas de quem está logado, para autocomplete e filtro (sem paginação). */
export function useEtiquetas() {
  return useQuery({
    queryKey: chaveEtiquetas,
    queryFn: () => api.get<Etiqueta[]>(`${BASE}tags/`),
    staleTime: 60_000,
  })
}

/**
 * As escritas. Todas invalidam `chaveNotas` inteiro de propósito: uma nota
 * criada pelo chamado tem de aparecer na `/notas`, e fixar/arquivar muda em
 * qual recorte (`?state=`) ela cai — invalidar só a lista corrente deixaria
 * as outras mentindo.
 */
export function useAcoesNota() {
  const qc = useQueryClient()
  const recarregar = () => qc.invalidateQueries({ queryKey: chaveNotas })

  const criar = useMutation({
    mutationFn: (entrada: EntradaNota) => api.post<Nota>(BASE, entrada),
    onSuccess: recarregar,
  })

  const salvar = useMutation({
    mutationFn: ({ id, ...entrada }: EntradaNota & { id: number }) =>
      api.patch<Nota>(`${BASE}${id}/`, entrada),
    onSuccess: (nota) => {
      qc.setQueryData(chaveNota(nota.id), nota)
      recarregar()
    },
  })

  // Exclusão LÓGICA: vai para a lixeira e dá para voltar (`restaurar`).
  const excluir = useMutation({
    mutationFn: (id: number) => api.delete<void>(`${BASE}${id}/`),
    onSuccess: recarregar,
  })

  const restaurar = useMutation({
    mutationFn: (id: number) => api.post<Nota>(`${BASE}${id}/restore/`),
    onSuccess: recarregar,
  })

  return { criar, salvar, excluir, restaurar }
}
