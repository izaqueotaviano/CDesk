import { useMutation } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { LoginPendente, Me } from '@/api/types'

/**
 * Passo 1 de 2. Anônimo — não precisa (nem deve) mandar X-CSRFToken; o
 * client.ts já não manda em GET, mas aqui é um POST então o header seria
 * enviado vazio se não houvesse sessão ainda, o que o Django aceita porque
 * esta view está fora do CsrfViewMiddleware para requisição anônima.
 * Duas respostas possíveis: `{two_factor}` quando a conta tem a verificação
 * em duas etapas ligada (a sessão fica pendente até o código), ou o próprio
 * `Me` quando não tem — aí a senha já entrou e o cookie de sessão existe.
 */
export function useLogin() {
  return useMutation({
    mutationFn: (dados: { email: string; password: string }) =>
      api.post<LoginPendente | Me>('/api/v1/auth/login/', dados),
  })
}

export function precisaDeCodigo(resposta: LoginPendente | Me): resposta is LoginPendente {
  return 'two_factor' in resposta && Boolean(resposta.two_factor)
}
