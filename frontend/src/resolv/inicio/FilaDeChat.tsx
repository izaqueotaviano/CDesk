import { useNavigate } from 'react-router-dom'
import { useFilaChat, usePegarChat } from '@/api/chat'
import { identidadeDe } from '@/ui/identidade'
import { iniciais } from '../chat/format'
import { Icone } from '../shell/Icone'

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
    <section className="inicio-secao" aria-labelledby="inicio-chat-fila">
      <header className="inicio-secao__cabecalho">
        <Icone nome="forum" />
        <h2 id="inicio-chat-fila">Chat na fila</h2>
        {!isLoading && (
          <span className={'md-badge' + (naFila.length > 0 ? ' md-badge--brand' : '')}>
            {naFila.length}
          </span>
        )}
        <button
          type="button"
          className="md-btn md-btn--texto md-btn--sm inicio-secao__acao"
          onClick={() => navigate('/chat')}
        >
          Ver console
        </button>
      </header>
      {isLoading ? (
        <p className="inicio-secao__vazio">Carregando…</p>
      ) : naFila.length === 0 ? (
        <p className="inicio-secao__vazio">Ninguém esperando agora.</p>
      ) : (
        <ul className="md-lista">
          {naFila.slice(0, LIMITE).map((c) => (
            <li key={c.id}>
              <div className="md-lista__item inicio-secao__item inicio-secao__item--inerte">
                <span className="md-avatar" aria-hidden="true" {...identidadeDe(c.client_name)}>
                  {iniciais(c.client_name)}
                </span>
                <span className="inicio-secao__texto">
                  <span className="inicio-secao__assunto">{c.client_name}</span>
                  <span className="inicio-secao__meta">{c.company_name}</span>
                </span>
                <button
                  type="button"
                  className="md-btn md-btn--tonal md-btn--sm"
                  disabled={pegar.isPending}
                  onClick={() =>
                    pegar.mutate(c.id, { onSuccess: (chat) => navigate(`/chat?chat=${chat.id}`) })
                  }
                >
                  Pegar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
