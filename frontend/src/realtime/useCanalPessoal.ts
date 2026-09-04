import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { conectarCanalPessoal } from './bridge'

/**
 * Chame uma vez, de dentro de uma tela que só renderiza com sessão confirmada
 * (AppShell/PortalShell, atrás de RotaProtegida) — o canal é autenticado pelo
 * cookie de sessão, abrir antes disso só falharia.
 */
export function useCanalPessoal() {
  const queryClient = useQueryClient()
  useEffect(() => {
    conectarCanalPessoal(queryClient)
    // Sem cleanup de propósito: "mantém um único WebSocket aberto durante
    // toda a sessão, sobrevive à troca de aba/rota" (docs/01-arquitetura.md).
  }, [queryClient])
}
