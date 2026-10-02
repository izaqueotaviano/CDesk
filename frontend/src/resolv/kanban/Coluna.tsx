import { useDroppable } from '@dnd-kit/core'
import { useId, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { MenuFlutuante, type ItemDoMenu } from '../shell/MenuFlutuante'
import { Cartao } from './Cartao'
import { contagemDaColuna, coresDaBarra, type StatusDoCartao } from './formato'
import type { Cartao as CartaoTipo, Coluna as ColunaTipo } from './tipos'

interface Props {
  coluna: ColunaTipo
  /** Os cartões VISÍVEIS (já filtrados). */
  cartoes: CartaoTipo[]
  /** Quantos a coluna tem de verdade, sem filtro: é esse número que o
   *  limite de WIP mede — filtrar a tela não esvazia a coluna da equipe. */
  total: number
  filtrando: boolean
  agoraMs: number
  /** Nome e cor do status de verdade de cada cartão (ver PaginaKanban). */
  statusDe: (cartao: CartaoTipo) => StatusDoCartao
  onAbrirTicket: (ticketId: number) => void
  onDefinirPrazo: (ticketId: number, iso: string | null) => void
  onApagarLane?: (laneId: number) => void
  /** Resolve quando o servidor aceitou; rejeita para o formulário ficar aberto. */
  onDefinirLimite?: (coluna: ColunaTipo, limite: number | null) => Promise<unknown>
  salvandoLimite?: boolean
}

function mensagemVazia(coluna: ColunaTipo, total: number, filtrando: boolean): string {
  if (coluna.concludes) return 'Solte um ticket aqui para fechá-lo. Tickets fechados saem do quadro.'
  if (filtrando && total > 0) return 'Nenhum ticket com estes filtros.'
  if (coluna.kind === 'lane') return 'Arraste tickets para cá para agrupá-los. O status não muda.'
  return 'Nenhum ticket. Arraste um cartão para cá.'
}

export function Coluna({
  coluna,
  cartoes,
  total,
  filtrando,
  agoraMs,
  statusDe,
  onAbrirTicket,
  onDefinirPrazo,
  onApagarLane,
  onDefinirLimite,
  salvandoLimite,
}: Props) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: coluna.key,
    data: { coluna },
  })
  const idTitulo = useId()
  const idLimite = useId()
  const botaoMenuRef = useRef<HTMLButtonElement>(null)
  const [menuAberto, setMenuAberto] = useState(false)
  const [editandoLimite, setEditandoLimite] = useState(false)
  const [valorLimite, setValorLimite] = useState('')
  const [erroLimite, setErroLimite] = useState<string | null>(null)

  const contagem = contagemDaColuna(cartoes.length, total, coluna.wip_limit, filtrando)

  // A coluna de conclusão fica sempre vazia (o chamado fechado sai do
  // quadro): nem limite nem apagar fazem sentido nela, então não há menu.
  const podeLimitar = !coluna.concludes && !!onDefinirLimite
  const podeApagar = coluna.kind === 'lane' && !!onApagarLane
  const itensMenu: ItemDoMenu[] = []
  if (podeLimitar) {
    itensMenu.push({
      rotulo: coluna.wip_limit != null ? 'Alterar limite' : 'Definir limite',
      icone: 'ti ti-adjustments-horizontal',
      onSelecionar: abrirLimite,
    })
    if (coluna.wip_limit != null) {
      itensMenu.push({
        rotulo: 'Remover limite',
        icone: 'ti ti-x',
        onSelecionar: () => void onDefinirLimite!(coluna, null).catch(() => {}),
      })
    }
  }
  if (podeApagar) {
    if (itensMenu.length) itensMenu.push({ tipo: 'separador' })
    itensMenu.push({
      rotulo: 'Apagar coluna',
      icone: 'ti ti-trash',
      perigo: true,
      onSelecionar: () => onApagarLane!(coluna.lane!),
    })
  }

  function abrirLimite() {
    setValorLimite(coluna.wip_limit != null ? String(coluna.wip_limit) : '')
    setErroLimite(null)
    setEditandoLimite(true)
  }

  function fecharLimite() {
    setEditandoLimite(false)
    // o foco volta para quem abriu, não para o topo da página
    requestAnimationFrame(() => botaoMenuRef.current?.focus())
  }

  async function salvarLimite(e: FormEvent) {
    e.preventDefault()
    const bruto = valorLimite.trim()
    const numero = bruto === '' ? null : Number(bruto)
    if (numero != null && (!Number.isInteger(numero) || numero < 1 || numero > 999)) {
      setErroLimite('Use um número inteiro de 1 a 999, ou deixe vazio para tirar o limite.')
      return
    }
    try {
      await onDefinirLimite!(coluna, numero)
      fecharLimite()
    } catch {
      // o motivo aparece no aviso da página; o formulário fica aberto com o
      // valor digitado para a pessoa corrigir ou cancelar
    }
  }

  // Colunas de organização não têm status: ficam num cinza neutro e cada
  // cartão traz a cor do SEU status. As de status usam a cor configurada.
  const cor = coluna.kind === 'lane' ? undefined : coluna.color
  const barra = coresDaBarra(cor ?? '')
  const estilo = {
    '--kb-cor': cor ?? 'var(--text-muted)',
    '--kb-barra': barra.fundo,
    '--kb-barra-texto': barra.texto,
  } as CSSProperties

  return (
    <section
      ref={setNodeRef}
      className={
        'kb-coluna' +
        (isOver ? ' kb-coluna--sobre' : '') +
        (active ? ' kb-coluna--alvo' : '') +
        (contagem.acima ? ' kb-coluna--acima' : '')
      }
      aria-labelledby={idTitulo}
      style={estilo}
    >
      <header className="kb-coluna__cabecalho">
        {/* A cor do status é o cabeçalho inteiro (barra cheia) e tinge a coluna
            e a faixa de cada cartão: o status se lê de longe, sem ler o nome.
            O que muda o CONTRATO da coluna é ela ser de organização, e isso
            ganha um sinal à parte. */}
        {coluna.kind === 'lane' && (
          <i
            className="ti ti-pin kb-coluna__tipo"
            title="Coluna de organização: agrupa sem mudar o status"
            aria-hidden="true"
          />
        )}
        <h2 className="kb-coluna__nome" id={idTitulo}>
          {coluna.name}
          {coluna.kind === 'lane' && <span className="kb-sr"> (coluna de organização)</span>}
        </h2>
        <span
          className={'kb-coluna__contador' + (contagem.acima ? ' kb-coluna__contador--acima' : '')}
          title={contagem.descricao}
        >
          <span aria-hidden="true">{contagem.texto}</span>
          <span className="kb-sr">{contagem.descricao}</span>
        </span>
        {itensMenu.length > 0 && (
          <>
            <button
              ref={botaoMenuRef}
              type="button"
              className="kb-coluna__menu"
              aria-label={`Opções da coluna ${coluna.name}`}
              aria-haspopup="menu"
              aria-expanded={menuAberto}
              onClick={() => setMenuAberto((v) => !v)}
            >
              <i className="ti ti-dots" aria-hidden="true" />
            </button>
            <MenuFlutuante
              aberto={menuAberto}
              onFechar={() => setMenuAberto(false)}
              itens={itensMenu}
              rotulo={`Opções da coluna ${coluna.name}`}
              obterAncora={() => botaoMenuRef.current}
              alinhar="fim"
            />
          </>
        )}
      </header>

      {editandoLimite && (
        <form className="kb-coluna__limite" onSubmit={salvarLimite} noValidate>
          <label htmlFor={idLimite}>Limite de tickets</label>
          <div className="kb-coluna__limite-linha">
            <input
              id={idLimite}
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              autoFocus
              value={valorLimite}
              aria-invalid={erroLimite ? true : undefined}
              aria-describedby={`${idLimite}-ajuda`}
              onChange={(e) => {
                setValorLimite(e.target.value)
                setErroLimite(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  fecharLimite()
                }
              }}
            />
            <button type="submit" className="kb-botao kb-botao--primario" disabled={salvandoLimite}>
              Salvar
            </button>
            <button type="button" className="kb-botao" onClick={fecharLimite}>
              Cancelar
            </button>
          </div>
          <p id={`${idLimite}-ajuda`} className={erroLimite ? 'kb-coluna__limite-erro' : 'kb-coluna__limite-ajuda'}>
            {erroLimite ?? 'Passar do limite só avisa, nada é bloqueado. Vazio tira o limite.'}
          </p>
        </form>
      )}

      <div className="kb-coluna__corpo">
        {cartoes.length === 0 ? (
          <p className="kb-coluna__vazia">{mensagemVazia(coluna, total, filtrando)}</p>
        ) : (
          cartoes.map((c) => (
            <Cartao
              key={c.ticket}
              cartao={c}
              status={statusDe(c)}
              mostrarStatus={coluna.kind === 'lane'}
              agoraMs={agoraMs}
              onAbrir={onAbrirTicket}
              onDefinirPrazo={onDefinirPrazo}
            />
          ))
        )}
      </div>
    </section>
  )
}
