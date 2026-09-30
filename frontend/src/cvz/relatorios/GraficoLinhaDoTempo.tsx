import type { PontoLinhaDoTempo } from './dados'
import { formatarDataCurta } from './formato'
import { GraficoColunas } from './GraficoColunas'

/**
 * Abertos × resolvidos por dia no período. "Resolvidos no prazo" não vira
 * uma terceira marca: ele é um pedaço de "resolvidos", e três colunas por dia
 * num mês inteiro viravam risco. Fica no tooltip, na tabela e no resumo em
 * texto logo abaixo, que é onde a pergunta "quanto do resolvido foi no
 * prazo?" se responde de uma vez.
 */
export function GraficoLinhaDoTempo({ pontos }: { pontos: PontoLinhaDoTempo[] }) {
  const resolvidos = pontos.reduce((soma, p) => soma + p.resolved, 0)
  const noPrazo = pontos.reduce((soma, p) => soma + p.resolved_on_time, 0)
  const reabertos = pontos.reduce((soma, p) => soma + p.reopened, 0)

  return (
    <div className="relatorios-linha-do-tempo">
      <GraficoColunas
        titulo="Tickets abertos e resolvidos por dia no período"
        unidade="ticket"
        series={[
          { key: 'opened', label: 'Abertos', tom: 'acento' },
          { key: 'resolved', label: 'Resolvidos', tom: 'apoio' },
        ]}
        grupos={pontos.map((p) => ({
          key: p.date,
          rotulo: formatarDataCurta(p.date),
          rotuloLongo: formatarDataCurta(p.date) + '/' + p.date.slice(0, 4),
          valores: { opened: p.opened, resolved: p.resolved },
          extras: [
            { label: 'No prazo', valor: p.resolved_on_time },
            { label: 'Reabertos', valor: p.reopened },
          ],
        }))}
      />
      {resolvidos > 0 && (
        <p className="relatorios-linha-do-tempo__resumo">
          {noPrazo} de {resolvidos} resolvido{resolvidos === 1 ? '' : 's'} no prazo
          {reabertos > 0 && `, ${reabertos} reabertura${reabertos === 1 ? '' : 's'} no período`}.
        </p>
      )}
    </div>
  )
}
