import { useNavigate } from 'react-router-dom'
import { useFilaChat, usePegarChat } from '@/api/chat'
import { iniciais } from '../chat/format'

const LIMITE = 4

/**
 * A fila de chat, resumida — o mesmo dado que já move o contador da Topbar
 * e o mini chat, aqui como lista de verdade: dá pra pegar um cliente
 * esperando sem sair da Início. "Meus atendimentos" fica de fora de
 * propósito — o mini chat (rodapé, em toda tela interna) já cobre isso;
 * repetir aqui seria a mesma informação duas vezes na mesma tela.
 */
export function FilaDeChat() {
  const navigate = useNavigate()
  const { data: fila, isLoading } = useFilaChat()
  const pegar = usePegarChat()

  const naFila = fila ?? []

  return (
    <div className="inicio-lista">
      <header className="inicio-lista__cabecalho">
        <h2>Chat na fila</h2>
        <button type="button" className="inicio-lista__ver-tudo" onClick={() => navigate('/chat')}>
          Ver console
        </button>
      </header>
      {isLoading ? (
        <p className="inicio-lista__vazio">Carregando…</p>
      ) : naFila.length === 0 ? (
        <p className="inicio-lista__vazio">Ninguém esperando agora.</p>
      ) : (
        <ul className="inicio-lista__itens">
          {naFila.slice(0, LIMITE).map((c) => (
            <li key={c.id}>
              <div className="inicio-lista__item inicio-lista__item--chat">
                <span className="inicio-chat__avatar" aria-hidden="true">
                  {iniciais(c.client_name)}
                </span>
                <span className="inicio-lista__texto">
                  <span className="inicio-lista__assunto">{c.client_name}</span>
                  <span className="inicio-lista__meta">{c.company_name}</span>
                </span>
                <button
                  type="button"
                  className="inicio-chat__pegar"
                  disabled={pegar.isPending}
                  onClick={() => pegar.mutate(c.id, { onSuccess: (chat) => navigate(`/chat?chat=${chat.id}`) })}
                >
                  Pegar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
