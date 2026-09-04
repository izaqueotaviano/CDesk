import { useMutation } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { LoginPendente } from '@/api/types'

/**
 * Passo 1 de 2. Anônimo — não precisa (nem deve) mandar X-CSRFToken; o
 * client.ts já não manda em GET, mas aqui é um POST então o header seria
 * enviado vazio se não houvesse sessão ainda, o que o Django aceita porque
 * esta view está fora do CsrfViewMiddleware para requisição anônima.
 * Sucesso aqui NÃO autentica — só cria a sessão pendente de 2FA.
 */
export function useLogin() {
  return useMutation({
    mutationFn: (dados: { email: string; password: string }) =>
      api.post<LoginPendente>('/api/v1/auth/login/', dados),
  })
}
