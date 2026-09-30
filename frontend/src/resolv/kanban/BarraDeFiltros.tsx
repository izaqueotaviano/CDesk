import type { ReactNode } from 'react'
import { ROTULO_PRIORIDADE } from '../tickets/format'
import type { Prioridade } from '../tickets/tipos'
import type { Filtros } from './filtros'

interface SeletorProps {
  rotulo: string
  icone: string
  valor: string
  /** O que se lê na pílula quando há valor escolhido ("Eu", "Acme"). */
  rotuloDoValor: string
  onMudar: (valor: string) => void
  children: ReactNode
}

/**
 * Pílula de filtro com um `<select>` nativo por cima, invisível. O nativo
 * é o controle de verdade (teclado, leitor de tela e a roda de opções do
 * celular vêm de graça); a pílula só DESENHA o estado: "Responsável" quando
 * vazio, "Responsável: Eu" quando escolhido, que o select sozinho não
 * consegue mostrar (ele mostraria só "Eu", sem dizer de quê).
 */
function Seletor({ rotulo, icone, valor, rotuloDoValor, onMudar, children }: SeletorProps) {
  return (
    <div className={'kb-filtro' + (valor ? ' kb-filtro--ativo' : '')}>
      <i className={icone} aria-hidden="true" />
      <span className="kb-filtro__texto" aria-hidden="true">
        {valor ? `${rotulo}: ${rotuloDoValor}` : rotulo}
      </span>
      <i className="ti ti-chevron-down kb-filtro__seta" aria-hidden="true" />
      <select aria-label={`Filtrar por ${rotulo.toLowerCase()}`} value={valor} onChange={(e) => onMudar(e.target.value)}>
        {children}
      </select>
    </div>
  )
}

const ORDEM_PRIORIDADE: Prioridade[] = ['urgent', 'high', 'normal', 'low']

interface Props {
  filtros: Filtros
  onMudar: (mudancas: Partial<Filtros>) => void
  onLimpar: () => void
  responsaveis: { id: number; nome: string }[]
  empresas: string[]
  ativo: boolean
  visiveis: number
  total: number
}

export function BarraDeFiltros({ filtros, onMudar, onLimpar, responsaveis, empresas, ativo, visiveis, total }: Props) {
  const rotuloResponsavel =
    filtros.responsavel === 'eu'
      ? 'Eu'
      : filtros.responsavel === 'nenhum'
        ? 'Sem responsável'
        : (responsaveis.find((r) => String(r.id) === filtros.responsavel)?.nome ?? 'Outro')
  // Link antigo pode trazer um responsável ou empresa que não tem mais
  // chamado aqui: a opção entra mesmo assim, senão o select mostraria
  // "Todos" com um filtro escondendo tudo.
  const responsavelForaDaLista =
    filtros.responsavel &&
    filtros.responsavel !== 'eu' &&
    filtros.responsavel !== 'nenhum' &&
    !responsaveis.some((r) => String(r.id) === filtros.responsavel)
  const empresaForaDaLista = filtros.empresa && !empresas.includes(filtros.empresa)

  return (
    <div className="kb-filtros" role="search" aria-label="Filtrar o quadro">
      <div className="kb-busca">
        <i className="ti ti-search" aria-hidden="true" />
        <input
          type="search"
          value={filtros.busca}
          onChange={(e) => onMudar({ busca: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && filtros.busca) {
              e.preventDefault()
              onMudar({ busca: '' })
            }
          }}
          placeholder="Buscar assunto, referência ou cliente"
          aria-label="Buscar por assunto, referência ou cliente"
        />
        {filtros.busca && (
          <button type="button" className="kb-busca__limpar" aria-label="Limpar busca" onClick={() => onMudar({ busca: '' })}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="kb-filtros__pilulas">
        <Seletor
          rotulo="Responsável"
          icone="ti ti-user"
          valor={filtros.responsavel}
          rotuloDoValor={rotuloResponsavel}
          onMudar={(v) => onMudar({ responsavel: v })}
        >
          <option value="">Todos</option>
          <option value="eu">Eu</option>
          <option value="nenhum">Sem responsável</option>
          {responsaveis.map((r) => (
            <option key={r.id} value={String(r.id)}>
              {r.nome}
            </option>
          ))}
          {responsavelForaDaLista && <option value={filtros.responsavel}>Outro</option>}
        </Seletor>

        <Seletor
          rotulo="Prioridade"
          icone="ti ti-arrows-up-down"
          valor={filtros.prioridade}
          rotuloDoValor={filtros.prioridade ? ROTULO_PRIORIDADE[filtros.prioridade] : ''}
          onMudar={(v) => onMudar({ prioridade: v as Prioridade | '' })}
        >
          <option value="">Todas</option>
          {ORDEM_PRIORIDADE.map((p) => (
            <option key={p} value={p}>
              {ROTULO_PRIORIDADE[p]}
            </option>
          ))}
        </Seletor>

        <Seletor
          rotulo="Empresa"
          icone="ti ti-building"
          valor={filtros.empresa}
          rotuloDoValor={filtros.empresa}
          onMudar={(v) => onMudar({ empresa: v })}
        >
          <option value="">Todas</option>
          {empresas.map((nome) => (
            <option key={nome} value={nome}>
              {nome}
            </option>
          ))}
          {empresaForaDaLista && <option value={filtros.empresa}>{filtros.empresa}</option>}
        </Seletor>

        <button
          type="button"
          className={'kb-filtro' + (filtros.atrasados ? ' kb-filtro--ativo' : '')}
          aria-pressed={filtros.atrasados}
          title="Prazo interno vencido ou SLA estourado"
          onClick={() => onMudar({ atrasados: !filtros.atrasados })}
        >
          <i className="ti ti-alarm" aria-hidden="true" />
          <span className="kb-filtro__texto">Só atrasados</span>
        </button>
      </div>

      <div className="kb-filtros__resumo">
        {/* Região viva SEMPRE montada (só o texto muda): uma que nasce junto
            com o conteúdo costuma não ser anunciada. Quem filtra pelo teclado
            ouve o resultado sem ir procurar coluna por coluna. */}
        <span role="status">{ativo ? `${visiveis} de ${total} ${total === 1 ? 'chamado' : 'chamados'}` : ''}</span>
        {ativo && (
          <button type="button" className="kb-filtros__limpar" onClick={onLimpar}>
            Limpar filtros
          </button>
        )}
      </div>
    </div>
  )
}
