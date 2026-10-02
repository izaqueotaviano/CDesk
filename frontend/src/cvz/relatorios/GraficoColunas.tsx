import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

/**
 * Colunas agrupadas desenhadas à mão (sem lib de gráfico no projeto — ver
 * docs/07-arquitetura-frontend.md). Serve à linha do tempo dos indicadores
 * (abertos × resolvidos por dia) e aos chats por período (uma série).
 *
 * Por que colunas e não linhas: a série é CONTAGEM por dia, e na maior parte
 * dos recortes quase todos os dias são zero. Uma linha liga os zeros e
 * transforma um único dia com movimento num pico pontudo — o "espinho"
 * laranja que a tela antiga desenhava. A coluna mostra exatamente o que
 * houve: um dia, uma barra.
 *
 * Desenho: marca fina (até 24px, cantos de 4px só na ponta), grade e eixo em
 * fio de 1px sólido e recessivo, texto sempre na tinta (nunca na cor da
 * série). Hover e teclado mostram a MESMA leitura: o SVG recebe foco, as
 * setas andam de coluna em coluna, e a tabela logo abaixo tem todos os
 * números sem depender de ponteiro.
 */

export interface SerieColunas {
  key: string
  label: string
  /** Classe de cor: `acento` (a série principal) ou `apoio` (a segunda). */
  tom: 'acento' | 'apoio'
}

export interface GrupoColunas {
  key: string
  /** Rótulo curto no eixo e no cabeçalho do tooltip ("06/09", "14h"). */
  rotulo: string
  /** Rótulo completo para o leitor de tela e a tabela ("06/09/2026"). */
  rotuloLongo?: string
  valores: Record<string, number>
  /** Linhas extras só do tooltip/tabela ("No prazo: 2"). */
  extras?: { label: string; valor: number }[]
}

const ALTURA = 200
const MARGEM = { topo: 12, direita: 8, base: 28, esquerda: 32 }
const LARGURA_PADRAO = 640
const COLUNA_MAX = 24

/** Largura real do contêiner — o SVG é desenhado em pixel, sem escala, para
 *  o texto do eixo continuar em 12px no celular (com `viewBox` esticado ele
 *  encolhia para 7px). Sem ResizeObserver (teste), fica a largura padrão. */
function useLargura() {
  const ref = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(LARGURA_PADRAO)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(([entrada]) => {
      const w = Math.round(entrada.contentRect.width)
      if (w > 0) setLargura(w)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return { ref, largura }
}

/** Topo "redondo" da escala e três marcas (0, meio, topo), só inteiros. */
function escala(maximo: number): number[] {
  if (maximo <= 4) return [0, Math.max(1, Math.ceil(maximo / 2)), Math.max(2, maximo)]
  const passo = Math.pow(10, Math.floor(Math.log10(maximo)))
  const topo = Math.ceil(maximo / passo) * passo
  const meio = topo / 2
  return Number.isInteger(meio) ? [0, meio, topo] : [0, topo]
}

/** Quais colunas ganham rótulo no eixo: todas quando cabem, senão uma a
 *  cada N — sempre a primeira e a última. */
function indicesRotulados(n: number, larguraUtil: number): number[] {
  const cabem = Math.max(2, Math.floor(larguraUtil / 44))
  if (n <= cabem) return Array.from({ length: n }, (_, i) => i)
  const passo = Math.ceil((n - 1) / (cabem - 1))
  const out: number[] = []
  for (let i = 0; i < n - 1; i += passo) out.push(i)
  // o último rótulo é obrigatório; o penúltimo sai se ficaria a menos de um
  // passo dele (no celular, "25/09" e "29/09" se atropelavam)
  if (out.length > 1 && n - 1 - out[out.length - 1] < passo) out.pop()
  out.push(n - 1)
  return out
}

/** Retângulo com 4px de raio só no topo — a ponta do dado; a base fica reta
 *  no eixo. */
function caminhoColuna(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

export function GraficoColunas({
  grupos,
  series,
  titulo,
  unidade = 'itens',
}: {
  grupos: GrupoColunas[]
  series: SerieColunas[]
  /** Descrição do gráfico para o leitor de tela. */
  titulo: string
  unidade?: string
}) {
  const { ref, largura } = useLargura()
  const [ativo, setAtivo] = useState<number | null>(null)

  const larguraUtil = Math.max(120, largura - MARGEM.esquerda - MARGEM.direita)
  const alturaUtil = ALTURA - MARGEM.topo - MARGEM.base
  const maximo = Math.max(0, ...grupos.flatMap((g) => series.map((s) => g.valores[s.key] ?? 0)))
  const marcas = escala(Math.max(1, maximo))
  const topo = marcas[marcas.length - 1]
  const y = (v: number) => MARGEM.topo + alturaUtil - (v / topo) * alturaUtil

  const faixa = larguraUtil / Math.max(1, grupos.length)
  // A coluna nunca enche a faixa: sobra ar entre um dia e outro, e 2px entre
  // as colunas do mesmo dia (o respiro na cor da superfície).
  const larguraColuna = Math.max(2, Math.min(COLUNA_MAX, (faixa * 0.7 - (series.length - 1) * 2) / series.length))
  const larguraGrupo = larguraColuna * series.length + (series.length - 1) * 2
  const xFaixa = (i: number) => MARGEM.esquerda + i * faixa

  const rotulados = new Set(indicesRotulados(grupos.length, larguraUtil))

  const indicePeloPonteiro = (e: PointerEvent<SVGSVGElement>) => {
    const caixa = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - caixa.left - MARGEM.esquerda
    const i = Math.floor(x / faixa)
    return i >= 0 && i < grupos.length ? i : null
  }

  const aoTeclar = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!grupos.length) return
    const atual = ativo ?? -1
    let proximo: number | null = null
    if (e.key === 'ArrowRight') proximo = Math.min(grupos.length - 1, atual + 1)
    else if (e.key === 'ArrowLeft') proximo = Math.max(0, atual < 0 ? grupos.length - 1 : atual - 1)
    else if (e.key === 'Home') proximo = 0
    else if (e.key === 'End') proximo = grupos.length - 1
    else if (e.key === 'Escape') {
      setAtivo(null)
      return
    }
    if (proximo != null) {
      e.preventDefault()
      setAtivo(proximo)
    }
  }

  const grupoAtivo = ativo != null ? grupos[ativo] : null
  // Tooltip ancorado na coluna, virando para a esquerda perto da borda.
  const xAtivo = ativo != null ? xFaixa(ativo) + faixa / 2 : 0
  const tooltipAEsquerda = xAtivo > largura * 0.6

  return (
    <div className="grafico-colunas" ref={ref}>
      <div className="grafico-colunas__legenda" aria-hidden={series.length < 2}>
        {series.length > 1 &&
          series.map((s) => (
            <span key={s.key} className="grafico-colunas__chave">
              <span className={`grafico-colunas__amostra grafico-colunas__amostra--${s.tom}`} />
              {s.label}
            </span>
          ))}
      </div>

      <div className="grafico-colunas__area">
        <svg
          width={largura}
          height={ALTURA}
          className="grafico-colunas__svg"
          role="img"
          aria-label={`${titulo}. Use as setas para ler dia a dia; os números também estão na tabela abaixo.`}
          tabIndex={0}
          onPointerMove={(e) => setAtivo(indicePeloPonteiro(e))}
          onPointerLeave={() => setAtivo(null)}
          onKeyDown={aoTeclar}
          onBlur={() => setAtivo(null)}
        >
          {marcas.map((m) => (
            <g key={m}>
              <line
                x1={MARGEM.esquerda}
                x2={MARGEM.esquerda + larguraUtil}
                y1={y(m)}
                y2={y(m)}
                className={m === 0 ? 'grafico-colunas__eixo' : 'grafico-colunas__grade'}
              />
              <text x={MARGEM.esquerda - 8} y={y(m)} dy="0.32em" textAnchor="end" className="grafico-colunas__marca">
                {m.toLocaleString('pt-BR')}
              </text>
            </g>
          ))}

          {ativo != null && (
            <rect
              x={xFaixa(ativo)}
              y={MARGEM.topo}
              width={faixa}
              height={alturaUtil}
              className="grafico-colunas__foco"
            />
          )}

          {grupos.map((g, i) => {
            const x0 = xFaixa(i) + (faixa - larguraGrupo) / 2
            return (
              <g key={g.key}>
                {series.map((s, j) => {
                  const v = g.valores[s.key] ?? 0
                  if (v <= 0) return null
                  // Mínimo de 2px: um "1" num eixo que vai a 40 não pode sumir.
                  const h = Math.max(2, (v / topo) * alturaUtil)
                  return (
                    <path
                      key={s.key}
                      d={caminhoColuna(x0 + j * (larguraColuna + 2), MARGEM.topo + alturaUtil - h, larguraColuna, h)}
                      className={`grafico-colunas__coluna grafico-colunas__coluna--${s.tom}`}
                    />
                  )
                })}
                {rotulados.has(i) && (
                  <text
                    x={xFaixa(i) + faixa / 2}
                    y={ALTURA - 8}
                    textAnchor={i === 0 && grupos.length > 1 ? 'start' : i === grupos.length - 1 && grupos.length > 1 ? 'end' : 'middle'}
                    dx={i === 0 && grupos.length > 1 ? -faixa / 2 + 2 : i === grupos.length - 1 && grupos.length > 1 ? faixa / 2 - 2 : 0}
                    className="grafico-colunas__marca"
                  >
                    {g.rotulo}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {grupoAtivo && (
          <div
            className={'grafico-colunas__tooltip' + (tooltipAEsquerda ? ' grafico-colunas__tooltip--esquerda' : '')}
            style={{ left: tooltipAEsquerda ? xAtivo - faixa / 2 - 8 : xAtivo + faixa / 2 + 8 }}
            role="status"
          >
            <span className="grafico-colunas__tooltip-titulo">{grupoAtivo.rotuloLongo ?? grupoAtivo.rotulo}</span>
            {series.map((s) => (
              <span key={s.key} className="grafico-colunas__tooltip-linha">
                <span className={`grafico-colunas__traco grafico-colunas__traco--${s.tom}`} aria-hidden="true" />
                <b>{(grupoAtivo.valores[s.key] ?? 0).toLocaleString('pt-BR')}</b> {s.label.toLowerCase()}
              </span>
            ))}
            {grupoAtivo.extras?.map((x) => (
              <span key={x.label} className="grafico-colunas__tooltip-linha grafico-colunas__tooltip-linha--extra">
                <b>{x.valor.toLocaleString('pt-BR')}</b> {x.label.toLowerCase()}
              </span>
            ))}
          </div>
        )}
      </div>

      {maximo === 0 && (
        <p className="grafico-colunas__vazio">Nenhum {unidade} no período. Escolha outro período acima.</p>
      )}

      <details className="grafico-colunas__tabela">
        <summary>Ver os números em tabela</summary>
        <div className="relatorios-tabela__wrap">
          <table className="relatorios-tabela">
            <thead>
              <tr>
                <th scope="col">Data</th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="num">
                    {s.label}
                  </th>
                ))}
                {grupos[0]?.extras?.map((x) => (
                  <th key={x.label} scope="col" className="num">
                    {x.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.key}>
                  <th scope="row">{g.rotuloLongo ?? g.rotulo}</th>
                  {series.map((s) => (
                    <td key={s.key} className={'num' + ((g.valores[s.key] ?? 0) === 0 ? ' relatorios-zero' : '')}>
                      {g.valores[s.key] ?? 0}
                    </td>
                  ))}
                  {g.extras?.map((x) => (
                    <td key={x.label} className={'num' + (x.valor === 0 ? ' relatorios-zero' : '')}>
                      {x.valor}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
