import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Me } from '@/api/types'

/**
 * Passo 2 de 2. Só AQUI a sessão vira autenticada — e é só AQUI que o cookie
 * `csrftoken` passa a existir (docs/10-frontend-novo.md). Por isso a resposta
 * já é o payload de usuário (igual /auth/me/): popular o cache de ['me']
 * direto evita um round-trip extra que só repetiria o que a 2FA já devolveu.
 */
export function useConfirmar2fa() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dados: { code: string }) => api.post<Me>('/api/v1/auth/2fa/', dados),
    onSuccess: (me) => {
      queryClient.setQueryData(['me'], me)
    },
  })
}

export function useReenviar2fa() {
  return useMutation({
    mutationFn: () => api.post<void>('/api/v1/auth/2fa/resend/'),
  })
}
