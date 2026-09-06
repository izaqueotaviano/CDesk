import type { Fatia } from './dados'

/**
 * Lista de barras horizontais — a mesma peça serve para as distribuições
 * (status, prioridade, categoria, empresa, solicitante, agente) e para os
 * baldes de SLA (primeira resposta, resolução): em ambos os casos é só
 * rótulo + contagem, do maior para o menor.
 */
export function Distribuicao({
  titulo,
  itens,
  vazio = 'Sem dados no período.',
}: {
  titulo: string
  itens: Fatia[]
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
          {itens.map((item) => (
            <li key={item.label} className="relatorios-distribuicao__linha">
              <span className="relatorios-distribuicao__rotulo" title={item.label}>
                {item.label}
              </span>
              <span className="relatorios-distribuicao__barra-trilho">
                <span
                  className="relatorios-distribuicao__barra"
                  style={{ width: `${(item.value / max) * 100}%` }}
                />
              </span>
              <span className="relatorios-distribuicao__valor">{item.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
