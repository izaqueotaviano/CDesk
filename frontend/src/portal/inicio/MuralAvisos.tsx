import { IconAlertTriangle, IconBeach, IconCalendarEvent, IconInfoCircle, IconX, type Icon } from '@tabler/icons-react'
import { useAvisosDoMural, useDispensarAviso, type TipoAviso } from '@/api/avisos'
import { Alert, type AlertProps } from '../ui/alert'
import { Button } from '../ui/button'
import { toast } from '../ui/toaster'

// Um ícone e um tom por tipo, como o Mural do console (resolv/inicio/
// MuralAvisos.tsx): feriado e férias são informação de agenda, não alerta —
// vão em âmbar e em `status`, sem interromper o leitor de tela. Só o
// urgente é `alert` de verdade.
const APRESENTACAO: Record<TipoAviso, { variante: NonNullable<AlertProps['variant']>; icone: Icon; papel: AlertProps['papel'] }> = {
  info: { variante: 'info', icone: IconInfoCircle, papel: 'status' },
  urgent: { variante: 'destructive', icone: IconAlertTriangle, papel: 'alert' },
  holiday: { variante: 'warning', icone: IconCalendarEvent, papel: 'status' },
  vacation: { variante: 'warning', icone: IconBeach, papel: 'status' },
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
      {avisos.map((a) => {
        const { variante, icone, papel } = APRESENTACAO[a.kind]
        return (
          <Alert
            key={a.id}
            variant={variante}
            icone={icone}
            papel={papel}
            titulo={a.title}
            fechar={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Dispensar aviso"
                disabled={dispensar.isPending}
                onClick={() =>
                  dispensar.mutate(a.id, {
                    onError: () => toast.error('Não foi possível dispensar o aviso. Tente de novo.'),
                  })
                }
              >
                <IconX />
              </Button>
            }
          >
            {a.body}
          </Alert>
        )
      })}
    </div>
  )
}
