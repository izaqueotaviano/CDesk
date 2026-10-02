import { useNavigate } from 'react-router-dom'
import { abrirPainelAtalhos } from './estado'
import { PainelAtalhos } from './PainelAtalhos'
import { useAtalhos } from './useAtalhos'

/**
 * Os atalhos do grupo "Geral" — valem em qualquer tela do console — e o
 * painel que lista todos. Montado UMA vez, no NovoShell.
 *
 * `Esc` não é registrado aqui: cada coisa que abre (busca, gaveta, painel,
 * diálogo) já fecha com Esc por conta própria, e o detalhe do ticket
 * registra o dele para as gavetas laterais. O catálogo lista o Esc para o
 * painel ficar completo.
 */
export function AtalhosGlobais({ onAbrirBusca }: { onAbrirBusca: () => void }) {
  const navigate = useNavigate()

  useAtalhos({
    'geral.ajuda': () => abrirPainelAtalhos(),
    'geral.busca': () => onAbrirBusca(),
    'geral.ir-inicio': () => navigate('/inicio'),
    'geral.ir-tickets': () => navigate('/tickets'),
    'geral.ir-chats': () => navigate('/chat'),
    'geral.ir-quadro': () => navigate('/quadro'),
  })

  return <PainelAtalhos />
}
