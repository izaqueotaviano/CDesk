import type { PontoLinhaDoTempo } from './dados'
import { formatarDataCurta } from './formato'

const LARGURA = 640
const ALTURA = 200
const PAD = 24

/**
 * Série diária desenhada à mão (sem lib de gráfico — nenhuma existe no
 * projeto hoje, ver decisão em docs/07-arquitetura-frontend.md). "Resolvidos
 * no prazo" anda ao lado de "Resolvidos" de propósito: a distância entre as
 * duas linhas É o cumprimento do SLA ao longo do tempo (mesma lógica do
 * backend, `_timeline` em indicators.py).
 */
export function GraficoLinhaDoTempo({ pontos }: { pontos: PontoLinhaDoTempo[] }) {
  const totalReabertos = pontos.reduce((soma, p) => soma + p.reopened, 0)

  if (pontos.length < 2) {
    const p = pontos[0]
    return (
      <div className="relatorios-linha-do-tempo relatorios-linha-do-tempo--curta">
        <p>
          {p ? (
            <>
              {p.opened} aberto(s), {p.resolved} resolvido(s) — só um dia neste período, sem série para desenhar.
            </>
          ) : (
            'Sem dados no período.'
          )}
        </p>
      </div>
    )
  }

  const max = Math.max(1, ...pontos.flatMap((p) => [p.opened, p.resolved]))
  const passoX = (LARGURA - PAD * 2) / (pontos.length - 1)
  const x = (i: number) => PAD + i * passoX
  const y = (v: number) => ALTURA - PAD - (v / max) * (ALTURA - PAD * 2)
  const linha = (chave: 'opened' | 'resolved' | 'resolved_on_time') =>
    pontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[chave]).toFixed(1)}`).join(' ')

  return (
    <div className="relatorios-linha-do-tempo">
      <svg
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        className="relatorios-linha-do-tempo__svg"
        role="img"
        aria-label="Tickets abertos e resolvidos por dia no período"
      >
        <line x1={PAD} y1={ALTURA - PAD} x2={LARGURA - PAD} y2={ALTURA - PAD} className="relatorios-linha-do-tempo__eixo" />
        <path d={linha('opened')} className="relatorios-linha-do-tempo__serie relatorios-linha-do-tempo__serie--aberto" />
        <path d={linha('resolved_on_time')} className="relatorios-linha-do-tempo__serie relatorios-linha-do-tempo__serie--no-prazo" />
        <path d={linha('resolved')} className="relatorios-linha-do-tempo__serie relatorios-linha-do-tempo__serie--resolvido" />
      </svg>
      <div className="relatorios-linha-do-tempo__rodape">
        <div className="relatorios-linha-do-tempo__legenda">
          <span className="relatorios-linha-do-tempo__item relatorios-linha-do-tempo__item--aberto">Abertos</span>
          <span className="relatorios-linha-do-tempo__item relatorios-linha-do-tempo__item--resolvido">Resolvidos</span>
          <span className="relatorios-linha-do-tempo__item relatorios-linha-do-tempo__item--no-prazo">No prazo</span>
          {totalReabertos > 0 && <span className="relatorios-linha-do-tempo__item">{totalReabertos} reabertura(s) no período</span>}
        </div>
        <div className="relatorios-linha-do-tempo__datas">
          <span>{formatarDataCurta(pontos[0].date)}</span>
          <span>{formatarDataCurta(pontos[pontos.length - 1].date)}</span>
        </div>
      </div>
    </div>
  )
}
