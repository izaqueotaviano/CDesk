import { PeriodoPersonalizado, PilulaSolicitante } from './BarraFiltros'
import {
  DIMENSOES,
  dimensaoAtiva,
  mudancaAoAlternar,
  opcoesComSelecionados,
  opcoesDe,
  resumoDaDimensao,
  selecionadosDe,
  type MudancaDeFiltro,
} from './dimensoes'
import { valoresDe, type Filtros } from './filtros'
import { OpcoesDoFiltro } from './OpcoesDoFiltro'
import type { Facetas } from './tipos'

interface Props {
  filtros: Filtros
  facetas: Facetas | undefined
  meuId?: number
  onMudar: (m: MudancaDeFiltro) => void
  rotuloSolicitante?: string
}

/**
 * Os mesmos filtros da barra do computador, empilhados numa folha (o Modal
 * do cvz vira folha de baixo no celular). Cada dimensão é um `<details>`:
 * nove listas abertas de uma vez seriam três telas de rolagem, e o resumo
 * no `<summary>` já diz o que está ligado sem abrir nada.
 */
export function FiltrosMobile({ filtros, facetas, meuId, onMudar, rotuloSolicitante }: Props) {
  return (
    <div className="filtros-mobile">
      {filtros.solicitante && (
        <div className="filtros-mobile__fixo">
          <PilulaSolicitante
            nome={rotuloSolicitante}
            onLimpar={() => onMudar({ solicitante: undefined })}
          />
        </div>
      )}
      {DIMENSOES.map((d) => {
        const selecionados =
          d.chave === 'periodo' ? valoresDe(filtros.periodo) : selecionadosDe(d.chave, filtros)
        const opcoes = opcoesComSelecionados(opcoesDe(d.chave, facetas, meuId), selecionados)
        const resumo = resumoDaDimensao(d.chave, filtros, opcoes)
        return (
          <details
            key={d.chave}
            className="filtros-mobile__secao"
            open={dimensaoAtiva(d.chave, filtros) || undefined}
          >
            <summary>
              <span className="filtros-mobile__rotulo">{d.rotulo}</span>
              {resumo && <span className="filtros-mobile__resumo">{resumo}</span>}
              <i className="ti ti-chevron-down" aria-hidden="true" />
            </summary>
            <OpcoesDoFiltro
              rotulo={d.rotulo}
              opcoes={opcoes}
              selecionados={selecionados}
              multiplo={d.multiplo}
              onAlternar={(valor) => onMudar(mudancaAoAlternar(d, filtros, valor))}
            />
            {d.chave === 'periodo' && (
              <PeriodoPersonalizado filtros={filtros} onAplicar={onMudar} />
            )}
          </details>
        )
      })}
    </div>
  )
}
