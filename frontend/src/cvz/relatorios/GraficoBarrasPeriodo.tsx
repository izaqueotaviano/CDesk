import type { Granularidade, PontoEstatisticaChat } from './dados'
import { GraficoColunas } from './GraficoColunas'

/** Rótulo curto do balde pela granularidade — o backend manda ISO
 *  ("2026-09-06T14:00:00", "2026-09-06", "2026-09", "2026"). */
function rotuloDoBalde(balde: string, granularidade: Granularidade): { curto: string; longo: string } {
  const [data, hora] = balde.split('T')
  const [ano, mes, dia] = data.split('-')
  if (granularidade === 'hour' && hora) return { curto: `${hora.slice(0, 2)}h`, longo: `${dia}/${mes}/${ano} às ${hora.slice(0, 2)}h` }
  if (granularidade === 'month' || (!dia && mes)) return { curto: `${mes}/${ano.slice(2)}`, longo: `${mes}/${ano}` }
  if (granularidade === 'year' || !mes) return { curto: ano, longo: ano }
  return { curto: `${dia}/${mes}`, longo: `${dia}/${mes}/${ano}` }
}

/** Chats atendidos por balde de tempo — uma série só, no acento. */
export function GraficoBarrasPeriodo({
  pontos,
  granularidade = 'day',
}: {
  pontos: PontoEstatisticaChat[]
  granularidade?: Granularidade
}) {
  return (
    <GraficoColunas
      titulo="Chats atendidos por período"
      unidade="chat"
      series={[{ key: 'count', label: 'Chats', tom: 'acento' }]}
      grupos={pontos.map((p) => {
        const r = rotuloDoBalde(p.bucket, granularidade)
        return { key: p.bucket, rotulo: r.curto, rotuloLongo: r.longo, valores: { count: p.count } }
      })}
    />
  )
}
