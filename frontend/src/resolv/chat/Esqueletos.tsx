import { Esqueleto } from '@/ui/Esqueleto'

/**
 * Esqueletos com a FORMA do que vai chegar — lista, conversa e painel — no
 * lugar dos "Carregando…" soltos. O texto some, o lugar de cada coisa não:
 * quando o dado chega, nada pula de posição.
 *
 * Todos sobre o `Esqueleto` de ui/ (a mesma textura do resto do produto);
 * aqui só se decide o desenho. `motion-reduce:animate-none`: quem pediu menos
 * movimento ao sistema vê o bloco parado, sem a pulsação.
 */

const SEM_MOVIMENTO = 'motion-reduce:animate-none'

/** Só para leitor de tela: o esqueleto em si é `aria-hidden`. */
function Anuncio({ texto }: { texto: string }) {
  return <span className="cc-visualmente-oculto">{texto}</span>
}

/** Linhas da lista de conversas: avatar, nome e a prévia embaixo. */
export function EsqueletoLista({ linhas = 4, rotulo = 'Carregando conversas' }: { linhas?: number; rotulo?: string }) {
  // larguras variadas: todas iguais leriam como uma tabela vazia, não como
  // uma lista de pessoas
  const larguras = ['w-[62%]', 'w-[48%]', 'w-[70%]', 'w-[55%]']
  return (
    <div className="cc-esqueleto" role="status">
      <Anuncio texto={rotulo} />
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="cc-esqueleto__linha" aria-hidden="true">
          <Esqueleto variante="avatar" className={`${SEM_MOVIMENTO} cc-esqueleto__avatar`} />
          <span className="cc-esqueleto__textos">
            <Esqueleto className={`${SEM_MOVIMENTO} block ${larguras[i % larguras.length]}`} />
            <Esqueleto className={`${SEM_MOVIMENTO} block w-[85%] cc-esqueleto__menor`} />
          </span>
        </div>
      ))}
    </div>
  )
}

/** A conversa: balões alternando de lado, como a rolagem vai ficar. */
export function EsqueletoConversa() {
  const baloes: { lado: 'cliente' | 'agente'; largura: string }[] = [
    { lado: 'cliente', largura: 'w-[46%]' },
    { lado: 'agente', largura: 'w-[38%]' },
    { lado: 'cliente', largura: 'w-[58%]' },
    { lado: 'agente', largura: 'w-[30%]' },
  ]
  return (
    <div className="cc-esqueleto cc-esqueleto--conversa" role="status">
      <Anuncio texto="Carregando a conversa" />
      {baloes.map((b, i) => (
        <div key={i} className={`cc-esqueleto__balao cc-esqueleto__balao--${b.lado}`} aria-hidden="true">
          <Esqueleto variante="bloco" className={`${SEM_MOVIMENTO} block h-10 ${b.largura}`} />
        </div>
      ))}
    </div>
  )
}

/** O painel do cliente: título de seção e pares rótulo/valor. */
export function EsqueletoPainel() {
  return (
    <div className="cc-esqueleto cc-esqueleto--painel" role="status">
      <Anuncio texto="Carregando os detalhes" />
      {[0, 1].map((secao) => (
        <div key={secao} className="cc-esqueleto__secao" aria-hidden="true">
          <Esqueleto className={`${SEM_MOVIMENTO} block w-[30%]`} />
          {[0, 1, 2].map((i) => (
            <span key={i} className="cc-esqueleto__par">
              <Esqueleto className={`${SEM_MOVIMENTO} block w-[28%]`} />
              <Esqueleto className={`${SEM_MOVIMENTO} block w-[52%]`} />
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
