import { X } from 'lucide-react'
import { useAvisosDoMural, useDispensarAviso, type TipoAviso } from '@/api/avisos'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'

const VARIANTE: Record<TipoAviso, 'info' | 'warning' | 'success' | 'destructive'> = {
  info: 'info',
  urgent: 'destructive',
  holiday: 'success',
  vacation: 'warning',
}

/** Avisos gerais da empresa/suporte para este cliente — geral, da própria
 *  empresa, ou do plano dela. Dispensar é só pra essa pessoa (não apaga o
 *  aviso pra ninguém mais). */
export function MuralAvisos() {
  const { data: avisos } = useAvisosDoMural()
  const dispensar = useDispensarAviso()

  if (!avisos || avisos.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {avisos.map((a) => (
        <Alert
          key={a.id}
          variant={VARIANTE[a.kind]}
          titulo={a.title}
          acao={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dispensar aviso"
              disabled={dispensar.isPending}
              onClick={() => dispensar.mutate(a.id)}
            >
              <X />
            </Button>
          }
        >
          {a.body}
        </Alert>
      ))}
    </div>
  )
}
