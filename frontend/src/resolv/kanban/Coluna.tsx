import { useDroppable } from '@dnd-kit/core'
import { Cartao } from './Cartao'
import type { Cartao as CartaoTipo, Coluna as ColunaTipo } from './tipos'

interface Props {
  coluna: ColunaTipo
  cartoes: CartaoTipo[]
  onAbrirTicket: (ticketId: number) => void
  onDefinirPrazo: (ticketId: number, iso: string | null) => void
  onApagarLane?: (laneId: number) => void
  idArrastando: number | null
}

export function Coluna({ coluna, cartoes, onAbrirTicket, onDefinirPrazo, onApagarLane, idArrastando }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: coluna.key,
    data: { coluna },
  })

  return (
    <div
      ref={setNodeRef}
      className={'kb-coluna' + (isOver ? ' kb-coluna--sobre' : '')}
      aria-label={`Coluna ${coluna.name}`}
    >
      <header className="kb-coluna__cabecalho">
        <span className="kb-coluna__cor" style={{ background: coluna.color }} aria-hidden />
        <h2 className="kb-coluna__nome">{coluna.name}</h2>
        <span className="kb-coluna__contador">{cartoes.length}</span>
        {coluna.kind === 'lane' && onApagarLane && (
          <button
            type="button"
            className="kb-coluna__apagar"
            aria-label={`Apagar coluna ${coluna.name}`}
            onClick={() => onApagarLane(coluna.lane!)}
          >
            <i className="ti ti-trash" />
          </button>
        )}
      </header>

      <div className="kb-coluna__corpo">
        {cartoes.length === 0 ? (
          <p className="kb-coluna__vazia">
            {coluna.concludes
              ? 'Solte um chamado aqui para concluir — a coluna fica sempre vazia.'
              : 'Nenhum chamado aqui.'}
          </p>
        ) : (
          cartoes.map((c) => (
            <Cartao
              key={c.ticket}
              cartao={c}
              onAbrir={onAbrirTicket}
              onDefinirPrazo={onDefinirPrazo}
              arrastando={idArrastando === c.ticket}
            />
          ))
        )}
      </div>
    </div>
  )
}
