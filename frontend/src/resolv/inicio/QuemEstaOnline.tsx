import { useAgentes } from '@/cvz/tickets/dados'
import { identidadeDe } from '@/ui/identidade'
import { iniciais } from '../chat/format'
import { Icone } from '../shell/Icone'

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
  const { data: agentes } = useAgentes()
  const online = (agentes ?? []).filter((a) => a.kind === 'internal' && a.presence !== 'offline')

  return (
    <section className="inicio-secao" aria-labelledby="inicio-equipe">
      <header className="inicio-secao__cabecalho">
        <Icone nome="groups" />
        <h2 id="inicio-equipe">Equipe agora</h2>
        <span className="md-badge">{online.length}</span>
      </header>
      {online.length === 0 ? (
        <p className="inicio-secao__vazio">Ninguém mais online agora.</p>
      ) : (
        <ul className="inicio-online">
          {online.map((a) => (
            <li
              key={a.id}
              className="inicio-online__pessoa"
              title={`${a.full_name} · ${ROTULO_PRESENCA[a.presence] ?? a.presence}`}
            >
              <span className="md-avatar" {...identidadeDe(a.full_name)}>
                {iniciais(a.full_name)}
                <span
                  className={`md-avatar__presenca md-avatar__presenca--${a.presence}`}
                  aria-hidden="true"
                />
              </span>
              <span className="inicio-online__nome">{a.full_name.split(' ')[0]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
