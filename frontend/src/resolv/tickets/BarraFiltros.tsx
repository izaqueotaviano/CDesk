import { useState, type ReactNode } from 'react'
import {
  DIMENSOES,
  dimensaoAtiva,
  mudancaAoAlternar,
  mudancaAoLimpar,
  opcoesComSelecionados,
  opcoesDe,
  resumoDaDimensao,
  selecionadosDe,
  type ChaveDimensao,
  type Dimensao,
  type MudancaDeFiltro,
} from './dimensoes'
import { contarFiltros, valoresDe, type Filtros } from './filtros'
import { FiltroPopover } from './FiltroPopover'
import { OpcoesDoFiltro } from './OpcoesDoFiltro'
import type { Facetas } from './tipos'

/** "Solicitante: Ana" — só existe ligado (vem do link do detalhe) e só se
 *  desliga; não há lista de solicitantes para escolher na barra. */
export function PilulaSolicitante({ nome, onLimpar }: { nome?: string; onLimpar: () => void }) {
  return (
    <div className="filtro filtro--ativo">
      <span className="filtro__pilula filtro__pilula--fixa">
        <span className="filtro__rotulo">Solicitante:</span>{' '}
        <span className="filtro__valor">{nome ?? 'selecionado'}</span>
      </span>
      <button
        type="button"
        className="filtro__limpar"
        aria-label="Limpar filtro solicitante"
        title="Limpar"
        onClick={onLimpar}
      >
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </div>
  )
}

/** Período personalizado (datas de abertura). Aplica no botão, não a cada
 *  tecla: uma data digitada pela metade seria um filtro por uma data que
 *  ninguém quis. */
export function PeriodoPersonalizado({
  filtros,
  onAplicar,
}: {
  filtros: Filtros
  onAplicar: (m: MudancaDeFiltro) => void
}) {
  const [desde, setDesde] = useState(filtros.desde ?? '')
  const [ate, setAte] = useState(filtros.ate ?? '')
  const invertido = Boolean(desde && ate && desde > ate)
  return (
    <form
      className="filtro-periodo"
      onSubmit={(e) => {
        e.preventDefault()
        if (invertido || (!desde && !ate)) return
        onAplicar({ periodo: undefined, desde: desde || undefined, ate: ate || undefined })
      }}
    >
      <p className="filtro-periodo__titulo">Personalizado</p>
      <div className="filtro-periodo__campos">
        <label>
          <span>De</span>
          <input
            type="date"
            value={desde}
            max={ate || undefined}
            onChange={(e) => setDesde(e.target.value)}
          />
        </label>
        <label>
          <span>Até</span>
          <input
            type="date"
            value={ate}
            min={desde || undefined}
            onChange={(e) => setAte(e.target.value)}
          />
        </label>
      </div>
      {invertido && <p className="filtro-periodo__erro">A data inicial vem depois da final.</p>}
      <button
        type="submit"
        className="filtro-periodo__aplicar"
        disabled={invertido || (!desde && !ate)}
      >
        Aplicar período
      </button>
    </form>
  )
}

interface Props {
  filtros: Filtros
  facetas: Facetas | undefined
  meuId?: number
  onMudar: (m: MudancaDeFiltro) => void
  onLimparTudo: () => void
  /** Antes das pílulas (o campo de busca da fila). */
  inicio?: ReactNode
  /** Nome do solicitante quando `?solicitante=` está ligado. */
  rotuloSolicitante?: string
  /** Ações à direita (salvar visão). */
  acoes?: ReactNode
}

/**
 * Barra de filtros da fila (computador e tablet). Cinco dimensões sempre à
 * vista, as outras quatro por "Mais filtros" — e essas viram pílula própria
 * assim que ganham valor, para o filtro ligado nunca ficar escondido atrás
 * de um menu.
 */
export function BarraFiltros({
  rotuloSolicitante,
  filtros,
  facetas,
  meuId,
  onMudar,
  onLimparTudo,
  inicio,
  acoes,
}: Props) {
  const [extraAberta, setExtraAberta] = useState<ChaveDimensao | null>(null)
  const ativos = contarFiltros(filtros)
  const visiveis = DIMENSOES.filter((d) => d.principal || dimensaoAtiva(d.chave, filtros))
  const escondidas = DIMENSOES.filter((d) => !d.principal && !dimensaoAtiva(d.chave, filtros))

  function conteudo(d: Dimensao, fechar: () => void) {
    const selecionados =
      d.chave === 'periodo' ? valoresDe(filtros.periodo) : selecionadosDe(d.chave, filtros)
    const opcoes = opcoesComSelecionados(opcoesDe(d.chave, facetas, meuId), selecionados)
    return (
      <>
        <OpcoesDoFiltro
          rotulo={d.rotulo}
          opcoes={opcoes}
          selecionados={selecionados}
          multiplo={d.multiplo}
          focarAoMontar
          onAlternar={(valor) => {
            onMudar(mudancaAoAlternar(d, filtros, valor))
            // Valor único: escolher é terminar. Lista: fica aberto para a
            // pessoa marcar a segunda opção sem reabrir.
            if (!d.multiplo) fechar()
          }}
        />
        {d.chave === 'periodo' && (
          <PeriodoPersonalizado
            filtros={filtros}
            onAplicar={(m) => {
              onMudar(m)
              fechar()
            }}
          />
        )}
      </>
    )
  }

  return (
    <div className="barra-filtros" role="group" aria-label="Filtros">
      <div className="barra-filtros__pilulas">
        {inicio}
        {filtros.solicitante && (
          <PilulaSolicitante
            nome={rotuloSolicitante}
            onLimpar={() => onMudar({ solicitante: undefined })}
          />
        )}
        {visiveis.map((d) => {
          const selecionados = d.chave === 'periodo' ? [] : selecionadosDe(d.chave, filtros)
          const opcoes = opcoesComSelecionados(opcoesDe(d.chave, facetas, meuId), selecionados)
          return (
            <FiltroPopover
              key={d.chave}
              rotulo={d.rotulo}
              resumo={resumoDaDimensao(d.chave, filtros, opcoes)}
              onLimpar={() => onMudar(mudancaAoLimpar(d.chave))}
            >
              {(fechar) => conteudo(d, fechar)}
            </FiltroPopover>
          )
        })}

        {escondidas.length > 0 && (
          <FiltroPopover
            rotulo="Mais filtros"
            resumo={null}
            icone="ti ti-plus"
            className="filtro--mais"
          >
            {(fechar) => {
              const d = escondidas.find((x) => x.chave === extraAberta)
              if (!d) {
                return (
                  <div className="filtro-mais" role="list">
                    {escondidas.map((x) => (
                      <button
                        key={x.chave}
                        type="button"
                        role="listitem"
                        className="filtro-mais__item"
                        autoFocus={x === escondidas[0]}
                        onClick={() => setExtraAberta(x.chave)}
                      >
                        {x.rotulo}
                        <i className="ti ti-chevron-right" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )
              }
              return (
                <>
                  <button
                    type="button"
                    className="filtro-mais__voltar"
                    onClick={() => setExtraAberta(null)}
                  >
                    <i className="ti ti-chevron-left" aria-hidden="true" />
                    {d.rotulo}
                  </button>
                  {conteudo(d, () => {
                    setExtraAberta(null)
                    fechar()
                  })}
                </>
              )
            }}
          </FiltroPopover>
        )}

        {ativos > 0 && (
          <button type="button" className="barra-filtros__limpar" onClick={onLimparTudo}>
            Limpar filtros
          </button>
        )}
        {/* Na mesma linha das pílulas, empurrado para a direita: um bloco
            à parte quebrava sozinho numa terceira linha. */}
        {acoes && <div className="barra-filtros__acoes">{acoes}</div>}
      </div>
    </div>
  )
}
