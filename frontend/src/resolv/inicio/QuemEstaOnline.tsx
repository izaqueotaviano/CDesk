import { useAgentes } from '@/cvz/tickets/dados'
import { Esqueleto } from '@/ui/Esqueleto'
import { identidadeDe } from '@/ui/identidade'
import { iniciais } from '../chat/format'

const ROTULO_PRESENCA: Record<string, string> = {
  available: 'Disponível',
  away: 'Ausente',
}

/**
 * Quem está disponível ou ausente agora — útil pra decidir pra quem
 * transferir ou de quem pedir uma segunda opinião sem abrir outra tela.
 * Offline fica de fora de propósito: listar todo mundo que não está online
 * não é "quem está online", é o diretório inteiro (que já existe em
 * Configurações → Papéis) — aqui o ponto é só quem responde agora.
 */
export function QuemEstaOnline() {
  const { data: agentes, isLoading } = useAgentes()
  const online = (agentes ?? []).filter((a) => a.kind === 'internal' && a.presence !== 'offline')

  return (
    <div className="inicio-lista">
      <header className="inicio-lista__cabecalho">
        <h2>Equipe agora</h2>
        {!isLoading && <span className="inicio-lista__contador">{online.length}</span>}
      </header>
      {isLoading ? (
        // Antes da lista chegar, "ninguém online" seria uma frase falsa por
        // um instante: o esqueleto tem a forma da grade de rostos que vem.
        <div role="status">
          <span className="sr-only">Carregando quem está online</span>
          <ul className="inicio-online__grade" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="inicio-online__pessoa">
                <Esqueleto variante="avatar" className="inicio-online__esq-avatar" />
                <Esqueleto className="inicio-online__esq-nome" />
              </li>
            ))}
          </ul>
        </div>
      ) : online.length === 0 ? (
        <p className="inicio-lista__vazio">Ninguém mais online agora.</p>
      ) : (
        <ul className="inicio-online__grade">
          {online.map((a) => (
            <li key={a.id} className="inicio-online__pessoa" title={`${a.full_name} · ${ROTULO_PRESENCA[a.presence] ?? a.presence}`}>
              <span className="inicio-online__avatar" {...identidadeDe(a.full_name)}>
                {iniciais(a.full_name)}
                <span className={`inicio-online__dot inicio-online__dot--${a.presence}`} aria-hidden="true" />
              </span>
              <span className="inicio-online__nome">{a.full_name.split(' ')[0]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
