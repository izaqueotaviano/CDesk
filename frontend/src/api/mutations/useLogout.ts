import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { desconectarCanalPessoal } from '@/realtime/bridge'
import { useChatUi } from '@/stores/chatUi'

/**
 * A armadilha documentada (docs/10-frontend-novo.md): esquecer o header
 * X-CSRFToken faz o PRÓPRIO LOGOUT devolver 403, e o sintoma engana porque
 * tudo o resto também estava dando 403 pelo mesmo motivo. `client.ts` já
 * cobre isso.
 *
 * `queryClient.clear()` sozinho NÃO tira a pessoa da tela: verificado contra
 * o backend real — o 204 chega, o cookie de sessão morre no servidor
 * (confirmado por um GET /auth/me/ manual devolvendo 403 logo depois), mas
 * sem navegação explícita a UI anterior continua na tela até a pessoa mexer
 * em algo. Por isso o redirect é explícito aqui, não delegado ao
 * `RotaProtegida` do próximo componente que montar.
 */
export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => api.post<void>('/api/v1/auth/logout/'),
    onSuccess: () => {
      desconectarCanalPessoal()
      // painéis e rascunhos do mini chat persistem no localStorage — a
      // próxima pessoa nesta máquina não pode herdá-los
      useChatUi.getState().limparTudo()
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })
}
