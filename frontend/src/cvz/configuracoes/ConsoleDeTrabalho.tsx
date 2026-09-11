import { useEffect, useRef } from 'react'
import { Button, Progress, Tag } from '@/cvz/components'
import { dataHora, trabalhoAtivo, type StatusTrabalho, type TrabalhoBase } from './dadosFerramentas'

const TOM: Record<StatusTrabalho, 'neutral' | 'blue' | 'success' | 'danger' | 'away'> = {
  pendente: 'neutral',
  rodando: 'blue',
  concluido: 'success',
  erro: 'danger',
  cancelado: 'away',
}

/**
 * O "load do que está fazendo": estado, etapa, barra e o log ao vivo de um
 * trabalho (importação ou backup). O log rola sozinho pro fim enquanto o
 * trabalho anda — depois de terminado, fica onde a pessoa deixou.
 */
export function ConsoleDeTrabalho({
  trabalho,
  titulo,
  onCancelar,
  cancelando = false,
}: {
  trabalho: TrabalhoBase
  titulo: string
  onCancelar?: () => void
  cancelando?: boolean
}) {
  const logRef = useRef<HTMLOListElement>(null)
  const ativo = trabalhoAtivo(trabalho)

  useEffect(() => {
    if (ativo && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [ativo, trabalho.log.length])

  const rotuloTempo = trabalho.finished_at
    ? `terminou ${dataHora(trabalho.finished_at)}`
    : trabalho.started_at
      ? `começou ${dataHora(trabalho.started_at)}`
      : `na fila desde ${dataHora(trabalho.created_at)}`

  return (
    <section className="cfg-console" aria-live="polite" aria-label={titulo}>
      <header className="cfg-console__topo">
        <div className="cfg-console__titulo">
          <strong>{titulo}</strong>
          <Tag tone={TOM[trabalho.status]} dot>
            {trabalho.status_label}
          </Tag>
          <span className="cfg-console__quando">
            {rotuloTempo}
            {trabalho.requested_by_name ? ` · ${trabalho.requested_by_name}` : ''}
          </span>
        </div>
        {ativo && onCancelar && (
          <Button variant="ghost" size="sm" onClick={onCancelar} disabled={cancelando}>
            {cancelando ? 'Cancelando…' : 'Cancelar'}
          </Button>
        )}
      </header>

      {ativo && (
        <Progress
          value={trabalho.progresso ?? undefined}
          label={trabalho.etapa || 'Aguardando o worker…'}
        />
      )}
      {!ativo && trabalho.etapa && <p className="cfg-console__etapa">{trabalho.etapa}</p>}

      {trabalho.erro && (
        <p className="cfg-console__erro" role="alert">
          {trabalho.erro}
        </p>
      )}

      <ol ref={logRef} className="cfg-console__log" aria-label="Registro do trabalho">
        {trabalho.log.length === 0 && <li className="cfg-console__linha">Sem registro ainda.</li>}
        {trabalho.log.map((l, i) => (
          <li key={`${l.t}-${i}`} className={`cfg-console__linha cfg-console__linha--${l.nivel}`}>
            <time dateTime={l.t}>{l.t.slice(11, 19)}</time> {l.msg}
          </li>
        ))}
      </ol>
    </section>
  )
}
