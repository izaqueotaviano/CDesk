import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

// ---------------------------------------------------------------------------
// Senha sem sessão: "Esqueci minha senha" e o convite.
//
// Os dois fluxos terminam no mesmo formulário (senha nova + confirmação) e
// diferem só no endpoint e no nome do campo — por isso o `modo` em vez de
// dois pares de hooks. Todos são públicos: quem chega aqui ainda não tem
// sessão, e nenhum deles cria uma (o login, com o 2FA de quem o tem, é
// sempre o passo seguinte).
// ---------------------------------------------------------------------------

/** `recuperacao`: link do "Esqueci minha senha" (vale 1 hora).
 *  `convite`: link do convite de acesso (vale 3 dias). */
export type ModoSenha = 'recuperacao' | 'convite'

const ENDPOINT: Record<ModoSenha, string> = {
  recuperacao: '/api/v1/auth/redefinir-senha/',
  convite: '/api/v1/auth/definir-senha/',
}

export interface ConferenciaDoLink {
  valid: boolean
  email?: string
  full_name?: string
  kind?: 'client' | 'internal'
}

export interface SenhaSalva {
  email: string
  kind?: 'client' | 'internal'
}

/** Pede o link por e-mail. A resposta é a mesma exista a conta ou não —
 *  a tela não tem como saber, e não deve fingir que sabe. */
export function usePedirLinkDeSenha() {
  return useMutation({
    mutationFn: (email: string) => api.post<{ detail: string }>('/api/v1/auth/recuperar-senha/', { email }),
  })
}

/** Confere o link ANTES de desenhar o formulário: descobrir que ele venceu
 *  depois de digitar a senha duas vezes é o pior momento possível. */
export function useConferirLinkDeSenha(modo: ModoSenha, uid: string, token: string) {
  return useQuery({
    queryKey: ['link-de-senha', modo, uid, token],
    queryFn: () => {
      const params = new URLSearchParams({ uid, token })
      return api.get<ConferenciaDoLink>(`${ENDPOINT[modo]}?${params}`)
    },
    retry: false,
    staleTime: Infinity,
    enabled: Boolean(uid && token),
  })
}

export function useSalvarSenhaPeloLink(modo: ModoSenha) {
  return useMutation({
    mutationFn: ({ uid, token, senha }: { uid: string; token: string; senha: string }) =>
      api.post<SenhaSalva>(
        ENDPOINT[modo],
        modo === 'recuperacao' ? { uid, token, new_password: senha } : { uid, token, password: senha },
      ),
  })
}
