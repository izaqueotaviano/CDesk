import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useMe } from '@/api/queries/useMe'
import { ApiError } from '@/api/client'

/**
 * `useQuery(['me'])` é a fonte única de sessão (docs/07-arquitetura-frontend.md).
 * 403 sem sessão vira `isError` (não throw) — aqui é onde isso vira redirect.
 */
export function RotaProtegida({ children, paraLogin = '/login' }: { children: ReactNode; paraLogin?: string }) {
  const { data, isLoading, error } = useMe()
  const location = useLocation()

  if (isLoading) return null // AppShell/PortalShell cuidam do esqueleto de carregamento

  if (error) {
    const foi403 = error instanceof ApiError && error.status === 403
    return (
      <Navigate
        to={foi403 ? paraLogin : '/sessao-expirada'}
        state={{ de: location.pathname }}
        replace
      />
    )
  }

  return data ? <>{children}</> : null
}
