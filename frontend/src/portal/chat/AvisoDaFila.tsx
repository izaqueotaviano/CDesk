import { IconClock, IconUsers } from '@tabler/icons-react'
import type { PosicaoNaFila } from '../api/chats'
import { cn } from '../lib/cn'
import { textoDaFila } from './fila'

/** A faixa sob o cabeçalho da conversa enquanto ela espera atendente. */
export function AvisoDaFila({ posicao, className }: { posicao: PosicaoNaFila; className?: string }) {
  const { titulo, detalhe, fechada } = textoDaFila(posicao)
  const Icone = fechada ? IconClock : IconUsers
  return (
    // `status` + `polite`: quem usa leitor de tela ouve a fila andar sem ser
    // interrompido no meio do que está escrevendo
    <div role="status" aria-live="polite" className={cn('flex items-start gap-2.5', className)}>
      <Icone
        className={cn('mt-px size-4 shrink-0', fechada ? 'text-alerta' : 'text-tinta-secundaria')}
        stroke={1.75}
        aria-hidden="true"
      />
      <p className="min-w-0 text-corpo text-tinta">
        <span className="font-medio">{titulo}.</span>
        {detalhe && <span className="text-tinta-secundaria"> {detalhe}</span>}
      </p>
    </div>
  )
}
