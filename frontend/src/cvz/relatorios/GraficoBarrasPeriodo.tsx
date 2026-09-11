import type { PontoEstatisticaChat } from './dados'

const LARGURA = 640
const ALTURA = 200
const PAD = 24

/**
 * Barras verticais desenhadas à mão — mesma decisão de `GraficoLinhaDoTempo`
 * (sem lib de gráfico, nenhuma existe no projeto hoje). Com granularidade
 * "hora" a janela padrão tem 48 baldes: rotular cada barra empilharia texto
 * ilegível, então só o primeiro, o último e um do meio ganham rótulo — o
 * mesmo cuidado que a linha do tempo toma com as datas do rodapé. Cada barra
 * carrega um `<title>` nativo do SVG com "balde: contagem" — dispensa
 * tooltip customizado para um hover tão simples.
 */
export function GraficoBarrasPeriodo({ pontos }: { pontos: PontoEstatisticaChat[] }) {
  if (pontos.length < 2) {
    const p = pontos[0]
    return (
      <div className="relatorios-barras-periodo relatorios-barras-periodo--curta">
        <p>{p ? `${p.bucket}: ${p.count} chat(s) — só um balde neste período, sem série para desenhar.` : 'Sem dados no período.'}</p>
      </div>
    )
  }

  const max = Math.max(1, ...pontos.map((p) => p.count))
  const areaUtil = LARGURA - PAD * 2
  const alturaUtil = ALTURA - PAD * 2
  const largBalde = areaUtil / pontos.length
  const xBalde = (i: number) => PAD + i * largBalde
  const alturaBarra = (v: number) => (v / max) * alturaUtil

  // primeiro, último e (quando existe um terceiro ponto distinto dos dois) o
  // do meio — os únicos índices que recebem rótulo embaixo do eixo
  const indicesRotulados = [0, Math.floor((pontos.length - 1) / 2), pontos.length - 1].filter(
    (i, pos, arr) => arr.indexOf(i) === pos,
  )

  return (
    <div className="relatorios-barras-periodo">
      <svg
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        className="relatorios-barras-periodo__svg"
        role="img"
        aria-label="Chats atendidos por balde de tempo no período"
      >
        <line x1={PAD} y1={ALTURA - PAD} x2={LARGURA - PAD} y2={ALTURA - PAD} className="relatorios-linha-do-tempo__eixo" />
        {pontos.map((p, i) => {
          const largura = largBalde * 0.6
          const altura = Math.max(alturaBarra(p.count), p.count > 0 ? 2 : 0)
          return (
            <rect
              key={p.bucket}
              x={xBalde(i) + (largBalde - largura) / 2}
              y={ALTURA - PAD - altura}
              width={largura}
              height={altura}
              className="relatorios-barras-periodo__barra"
            >
              <title>{`${p.bucket}: ${p.count}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="relatorios-linha-do-tempo__datas relatorios-barras-periodo__rotulos">
        {indicesRotulados.map((i) => (
          <span key={pontos[i].bucket}>{pontos[i].bucket}</span>
        ))}
      </div>
    </div>
  )
}
