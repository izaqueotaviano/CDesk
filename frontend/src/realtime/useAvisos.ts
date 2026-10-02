import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSincronizarPreferencias } from '@/stores/sincronizarPrefs'
import { definirNavegacao, iniciarAvisos } from './avisos'

/**
 * Chame de dentro de um shell autenticado (junto do `useCanalPessoal`): os
 * avisos dependem dos eventos do canal pessoal. Idempotente — os dois shells
 * (equipe e portal) chamam, e a assinatura é uma só.
 *
 * O `navigate` entra aqui porque o clique na notificação do sistema precisa
 * abrir a conversa/chamado sem recarregar a página, e o módulo de avisos vive
 * fora do React (é singleton, como a bridge).
 */
export function useAvisos() {
  const navigate = useNavigate()

  // As preferências da conta (som dos avisos, tamanho do texto, densidade)
  // entram aqui porque este é o único hook que os DOIS shells autenticados
  // já montam — e o som, a primeira delas, é justamente destes avisos.
  useSincronizarPreferencias()

  useEffect(() => {
    definirNavegacao((url) => navigate(url))
    iniciarAvisos()
  }, [navigate])
}
