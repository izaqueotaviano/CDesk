import { identidadeDe } from '@/ui/identidade'
import { FotoOuIniciais } from '../FotoOuIniciais'
import { descreverPresenca, primeiroNome, usePresentesNoTicket } from './contexto'
import type { PresenteTicket } from './usePresencaTicket'
import './colaboracao.scss'

/** Avatares visíveis; o resto vira "+N". */
const MAXIMO_AVATARES = 3

function rotuloDoAvatar(p: PresenteTicket): string {
  if (p.digitando === 'resposta') return `${p.nome}: respondendo ao cliente`
  if (p.digitando === 'nota') return `${p.nome}: escrevendo uma nota interna`
  return `${p.nome}: vendo este ticket`
}

/**
 * "Quem mais está aqui" no cabeçalho do ticket: pilha de avatares e a frase
 * ("Samuel está respondendo…", "Ana e Rita estão vendo"). Some quando a
 * pessoa está sozinha — ausência de colega não é informação que mereça
 * espaço no cabeçalho.
 *
 * A frase é `role="status"` para o leitor de tela ouvir a mudança (é o
 * mesmo aviso que um vidente recebe ao ver o avatar mudar); cada avatar tem
 * o nome inteiro e o que a pessoa está fazendo no `title`.
 */
export function PresencaTicket() {
  const presentes = usePresentesNoTicket()
  if (presentes.length === 0) return null

  const visiveis = presentes.slice(0, MAXIMO_AVATARES)
  const excedentes = presentes.length - visiveis.length
  const alguemResponde = presentes.some((p) => p.digitando === 'resposta')

  return (
    <div className={'presenca-ticket' + (alguemResponde ? ' presenca-ticket--respondendo' : '')}>
      <span className="presenca-ticket__avatares" aria-hidden="true">
        {visiveis.map((p) => (
          <span
            key={p.user_id}
            className={
              'presenca-ticket__avatar' + (p.digitando ? ' presenca-ticket__avatar--digitando' : '')
            }
            title={rotuloDoAvatar(p)}
            {...identidadeDe(p.nome)}
          >
            <FotoOuIniciais url={p.avatar_url} nome={p.nome} />
            {p.digitando && (
              <span className="presenca-ticket__digitando">
                <span />
                <span />
                <span />
              </span>
            )}
          </span>
        ))}
        {excedentes > 0 && (
          <span className="presenca-ticket__avatar presenca-ticket__avatar--mais">+{excedentes}</span>
        )}
      </span>
      <span className="presenca-ticket__texto" role="status">
        {descreverPresenca(presentes)}
      </span>
    </div>
  )
}

/**
 * Aviso suave logo acima do compositor quando OUTRA pessoa está escrevendo
 * uma resposta ao cliente — é aqui, e não só no cabeçalho, que a colisão
 * acontece: quem está escrevendo olha para o compositor, não para o topo.
 * Nota interna de colega não avisa: duas notas não confundem o cliente.
 */
export function AvisoColisao({ euDigitandoResposta }: { euDigitandoResposta: boolean }) {
  const presentes = usePresentesNoTicket()
  const respondendo = presentes.filter((p) => p.digitando === 'resposta')
  if (respondendo.length === 0) return null

  const nomes = respondendo.map((p) => primeiroNome(p.nome))
  const quem = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`
  const verbo = nomes.length === 1 ? 'está' : 'estão'

  return (
    <p className="aviso-colisao" role="status">
      <i className="ti ti-users" aria-hidden="true" />
      <span>
        <strong>
          {quem} {euDigitandoResposta ? `também ${verbo}` : verbo} respondendo ao cliente.
        </strong>{' '}
        {euDigitandoResposta
          ? 'Combine com a equipe antes de enviar, para o cliente não receber duas respostas.'
          : 'Vale esperar antes de começar outra resposta.'}
      </span>
    </p>
  )
}
