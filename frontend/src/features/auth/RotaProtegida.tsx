import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useMe } from '@/api/queries/useMe'
import { ApiError } from '@/api/client'

/**
 * `useQuery(['me'])` é a fonte única de sessão (docs/07-arquitetura-frontend.md).
 * "Sem sessão" vira `isError` (não throw) — aqui é onde isso vira redirect.
 *
 * 401 é o caso comum (nunca logou, ou a sessão expirou) — vai direto pro
 * login certo desta área. 403 continua tratado do mesmo jeito por segurança
 * (nenhuma view deveria devolvê-lo aqui, mas um 403 de verdade também
 * significa "sem sessão" do ponto de vista desta tela). Qualquer outro erro
 * (rede, 500) é que vira a tela de "sessão expirada" — algo deu errado que
 * não é simplesmente "faça login".
 */
export function RotaProtegida({ children, paraLogin = '/login' }: { children: ReactNode; paraLogin?: string }) {
  const { data, isLoading, error } = useMe()
  const location = useLocation()

  if (isLoading) return null // AppShell/PortalShell cuidam do esqueleto de carregamento

  if (error) {
    const semSessao = error instanceof ApiError && (error.status === 401 || error.status === 403)
    return (
      <Navigate
        to={semSessao ? paraLogin : '/sessao-expirada'}
        state={{ de: location.pathname }}
        replace
      />
    )
  }

  return data ? <>{children}</> : null
}
