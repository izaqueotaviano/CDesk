import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'

/**
 * Central de Ajuda — o conteúdo é do WordPress.
 *
 * O resolv nunca é um segundo lugar para escrever artigo: o time publica no
 * WordPress e a sincronização (`apps/knowledge/services/wordpress_sync.py`,
 * REST `/wp-json/wp/v2/{post_type}`) mantém um espelho local só de leitura.
 * A tela lê esse espelho — o que dá busca instantânea e o "isso ajudou?"
 * agregado, que ler direto do WordPress a cada tecla não daria.
 */

export interface ArtigoResumo {
  id: number
  title: string
  slug: string
  excerpt: string
  category: string
  tags: string[]
  wp_url: string
  wp_published_at: string | null
  wp_modified_at: string | null
  helpful_count: number
  not_helpful_count: number
  my_feedback: boolean | null
}

export interface Artigo extends ArtigoResumo {
  /** HTML já higienizado pelo servidor (nh3) — ver `ArticleDetailSerializer`. */
  body_html: string
  related: { id: number; title: string; slug: string }[]
}

export interface CategoriaAjuda {
  name: string
  count: number
}

export const chavesAjuda = {
  artigos: (p: { q?: string; categoria?: string }) => ['portal', 'ajuda', 'artigos', p] as const,
  artigo: (id: number) => ['portal', 'ajuda', 'artigo', id] as const,
  categorias: ['portal', 'ajuda', 'categorias'] as const,
}

function lista<T>(d: Paginado<T> | T[]): T[] {
  return Array.isArray(d) ? d : d.results
}

export function useArtigos({ q, categoria }: { q?: string; categoria?: string }) {
  const params = new URLSearchParams({ limit: '50' })
  if (q) params.set('q', q)
  if (categoria) params.set('category', categoria)
  return useQuery({
    queryKey: chavesAjuda.artigos({ q, categoria }),
    queryFn: () => api.get<Paginado<ArtigoResumo> | ArtigoResumo[]>(`/api/v1/knowledge/articles/?${params}`),
    select: lista,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}

export function useArtigo(id: number) {
  return useQuery({
    queryKey: chavesAjuda.artigo(id),
    queryFn: () => api.get<Artigo>(`/api/v1/knowledge/articles/${id}/`),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 60_000,
  })
}

export function useCategoriasAjuda() {
  return useQuery({
    queryKey: chavesAjuda.categorias,
    queryFn: () => api.get<CategoriaAjuda[]>('/api/v1/knowledge/articles/categories/'),
    staleTime: 300_000,
  })
}

interface RespostaFeedback {
  helpful_count: number
  not_helpful_count: number
  my_feedback: boolean
}

/** "Isso ajudou?" — um voto por pessoa, e mudar de ideia reescreve o voto. */
export function useAvaliarArtigo(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (helpful: boolean) =>
      api.post<RespostaFeedback>(`/api/v1/knowledge/articles/${id}/feedback/`, { helpful }),
    onSuccess: (r) => {
      qc.setQueryData<Artigo>(chavesAjuda.artigo(id), (a) =>
        a ? { ...a, helpful_count: r.helpful_count, not_helpful_count: r.not_helpful_count, my_feedback: r.my_feedback } : a,
      )
      void qc.invalidateQueries({ queryKey: ['portal', 'ajuda', 'artigos'] })
    },
  })
}
