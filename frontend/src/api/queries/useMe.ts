import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Me } from '@/api/types'

/**
 * Fonte única de sessão (docs/07-arquitetura-frontend.md: "useQuery(['me'])
 * sobre /auth/me/ é a fonte única"). 403 sem sessão vira `isError`, não throw
 * não tratado — quem consome decide o que fazer (mandar pro /login, etc).
 */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/api/v1/auth/me/'),
    retry: false,
    staleTime: 60_000,
  })
}
