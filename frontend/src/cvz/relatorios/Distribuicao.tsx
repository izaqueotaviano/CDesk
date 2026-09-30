import type { Fatia } from './dados'

/**
 * O que a cor da barra significa em cada gráfico:
 *
 * - `categorias` — série sem semântica (categoria, empresa, pessoa): uma cor
 *   só, o acento. Cada barra já tem o rótulo ao lado; seis tons ciclando por
 *   posição eram decoração, e a mesma empresa mudava de cor quando a ordem
 *   mudava. Os baldes ("Outros", "Não informada", "Sem responsável") ficam
 *   neutros — não são uma categoria a mais, são o resto.
 * - `status` — acento para novo e aberto; âmbar para aguardando retorno (é
 *   o único status que pede atenção); fechado cinza.
 * - `prioridade` — os tokens `$priority-*`: baixa cinza, normal no acento,
 *   alta âmbar, urgente vermelho.
 * - `sla` — no prazo verde, fora do prazo vermelho, aguardando âmbar, sem
 *   SLA cinza.
 *
 * Fatia sem `key` num esquema semântico cai no acento (sem modificador) —
 * nunca some, nunca quebra.
 */
export type EsquemaDeCores = 'categorias' | 'status' | 'prioridade' | 'sla'

type Tom = 'neutra' | 'acao' | 'sucesso' | 'atencao' | 'perigo'

/** Rótulos que o backend usa para "o resto" — balde, não categoria. */
const BALDES = new Set(['Outros', 'Não informada', 'Sem responsável'])

const POR_CHAVE: Record<Exclude<EsquemaDeCores, 'categorias'>, Record<string, Tom>> = {
  status: {
    new: 'acao',
    open: 'acao',
    pending_customer: 'atencao',
    closed: 'neutra',
  },
  prioridade: {
    low: 'neutra',
    normal: 'acao',
    high: 'atencao',
    urgent: 'perigo',
  },
  sla: {
    on_time: 'sucesso',
    late: 'perigo',
    waiting: 'atencao',
    no_sla: 'neutra',
    undefined: 'neutra',
  },
}

export function tomDaFatia(esquema: EsquemaDeCores, fatia: Fatia): Tom {
  if (esquema === 'categorias') return BALDES.has(fatia.label) ? 'neutra' : 'acao'
  return (fatia.key && POR_CHAVE[esquema][fatia.key]) || 'acao'
}

/**
 * Lista de barras horizontais — a mesma peça serve para as distribuições
 * (status, prioridade, categoria, empresa, solicitante, agente) e para os
 * baldes de SLA (primeira resposta, resolução): em ambos os casos é só
 * rótulo + contagem, do maior para o menor. A cor da barra diz o que ela é
 * (`esquema`); rótulo e número continuam sendo a informação — a cor é
 * reforço, não a única pista.
 */
export function Distribuicao({
  titulo,
  itens,
  esquema,
  vazio = 'Sem dados no período.',
}: {
  titulo: string
  itens: Fatia[]
  esquema: EsquemaDeCores
  vazio?: string
}) {
  const max = Math.max(1, ...itens.map((i) => i.value))
  const total = itens.reduce((soma, i) => soma + i.value, 0)

  return (
    <div className="relatorios-distribuicao">
      <h3 className="relatorios-distribuicao__titulo">{titulo}</h3>
      {total === 0 ? (
        <p className="relatorios-distribuicao__vazio">{vazio}</p>
      ) : (
        <ul className="relatorios-distribuicao__lista">
          {itens.map((item) => {
            const tom = tomDaFatia(esquema, item)
            return (
              <li key={item.label} className="relatorios-distribuicao__linha">
                <span className="relatorios-distribuicao__rotulo" title={item.label}>
                  {item.label}
                </span>
                <span className="relatorios-distribuicao__barra-trilho">
                  <span
                    className={
                      'relatorios-distribuicao__barra' +
                      (tom === 'acao' ? '' : ` relatorios-distribuicao__barra--${tom}`)
                    }
                    style={{ width: `${(item.value / max) * 100}%` }}
                  />
                </span>
                <span className="relatorios-distribuicao__valor">{item.value}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
