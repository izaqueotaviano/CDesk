import { useId } from 'react'
import { porcentagemDoUso, tomDoUso } from './uso'
import './detalhe-empresa.scss'

export interface MedidorDeUsoProps {
  rotulo: string
  usado: number
  /** `null` = sem limite: não há barra, só o texto. */
  limite: number | null
  /** A leitura em palavras — "5 de 30 tickets este mês". É ela que o leitor
   *  de tela ouve como valor do medidor, não "17 por cento". */
  descricao: string
  /** "Renova em 1 out" — o fim do período, à direita do rótulo. */
  renova?: string | null
}

/**
 * Consumo de uma franquia (cota de tickets, horas de manutenção).
 *
 * Não é o `Progress` do catálogo: aquele é progresso de TAREFA, com um tom
 * de destaque fixo; isto é uma MEDIDA contra um limite (`role="meter"`), e a
 * cor muda com o que a medida significa — neutra até 80%, alerta perto do
 * limite, perigo no limite (ver `tomDoUso`). O estado também sai em texto,
 * para a cor nunca ser o único sinal.
 */
export function MedidorDeUso({ rotulo, usado, limite, descricao, renova }: MedidorDeUsoProps) {
  const idRotulo = useId()
  const pct = porcentagemDoUso(usado, limite)
  const tom = pct == null ? 'neutro' : tomDoUso(pct)
  const estado =
    tom === 'perigo'
      ? limite != null && usado > limite
        ? 'Acima do limite'
        : 'Limite atingido'
      : tom === 'alerta'
        ? 'Perto do limite'
        : null

  return (
    <div className={`empresa-uso empresa-uso--${tom}`}>
      <div className="empresa-uso__cabeca">
        <span id={idRotulo} className="empresa-uso__rotulo">
          {rotulo}
        </span>
        {renova && <span className="empresa-uso__renova">Renova em {renova}</span>}
      </div>
      {pct != null && limite != null && (
        <div
          className="empresa-uso__trilho"
          role="meter"
          aria-labelledby={idRotulo}
          aria-valuemin={0}
          aria-valuemax={Math.max(limite, usado)}
          aria-valuenow={usado}
          aria-valuetext={descricao}
        >
          <span className="empresa-uso__barra" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
      <p className="empresa-uso__texto">{descricao}</p>
      {estado && (
        <p className="empresa-uso__estado">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          {estado}
        </p>
      )}
    </div>
  )
}
