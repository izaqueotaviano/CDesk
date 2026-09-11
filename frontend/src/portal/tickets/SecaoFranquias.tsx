import { IconMessage, IconTool, type Icon } from '@tabler/icons-react'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { useFranquiaManutencao } from '../api/franquia'
import { dataCurta, horasEMinutos } from '../lib/formato'
import { cn } from '../lib/cn'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Skeleton } from '../ui/skeleton'

type TomBarra = 'acento' | 'alerta' | 'perigo'

/** Mesmo corte de `toneDoUso` do painel do agente (cvz/clientes/PaginaDetalheEmpresa):
 *  ≥100% estourou, ≥75% chama atenção, resto é normal. */
function tomDoUso(usado: number, limite: number | null): TomBarra {
  if (!limite) return 'acento'
  const pct = (usado / limite) * 100
  if (pct >= 100) return 'perigo'
  if (pct >= 75) return 'alerta'
  return 'acento'
}

const COR_BARRA: Record<TomBarra, string> = {
  acento: 'bg-acento',
  alerta: 'bg-alerta',
  perigo: 'bg-perigo',
}

interface BlocoFranquiaProps {
  icone: Icon
  rotulo: string
  usado: number
  limite: number | null
  periodoInicio: string
  periodoFim: string
  /** Como escrever os números — cru (tickets) ou "5h30" (minutos). */
  formatar?: (n: number) => string
}

function BlocoFranquia({ icone: Icone, rotulo, usado, limite, periodoInicio, periodoFim, formatar }: BlocoFranquiaProps) {
  const fmt = formatar ?? String
  const tom = tomDoUso(usado, limite)
  const pct = limite ? Math.min(100, (usado / limite) * 100) : 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-pequeno font-medio text-tinta-secundaria">
        <Icone className="size-4" aria-hidden="true" />
        {rotulo}
      </div>

      {limite != null ? (
        <>
          <div className="h-2 w-full overflow-hidden rounded-total bg-navegacao" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn('h-full rounded-total transition-[width]', COR_BARRA[tom])} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-pequeno text-tinta">
            <span className="font-medio">{fmt(usado)}</span> de {fmt(limite)} usados
          </p>
        </>
      ) : (
        <p className="text-pequeno text-tinta-secundaria">Sem limite neste plano.</p>
      )}

      <p className="text-legenda text-tinta-terciaria">
        Período: {dataCurta(periodoInicio)} – {dataCurta(periodoFim)}
      </p>
    </div>
  )
}

/**
 * As duas franquias do cliente, lado a lado: tickets do período (docs/05
 * §2.5 — banner permanente, não só o erro na hora do bloqueio) e horas de
 * manutenção do mês (apps.customers.services.maintenance). São conceitos
 * irmãos com períodos diferentes de propósito — por isso dois blocos, cada
 * um com o próprio "Período", em vez de uma barra só fingindo que é uma
 * cota.
 */
export function SecaoFranquias() {
  const { data: me } = useMe()
  const manutencao = useFranquiaManutencao()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-titulo-sm">Franquias do mês</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        {!me?.quota ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <BlocoFranquia
            icone={IconMessage}
            rotulo="Chamados"
            usado={me.quota.used}
            limite={me.quota.limit}
            periodoInicio={me.quota.period_start}
            periodoFim={me.quota.period_end}
          />
        )}

        {manutencao.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : manutencao.isError || !manutencao.data ? (
          <Alert
            variant="destructive"
            titulo="Não foi possível carregar a franquia de manutenção"
            acao={
              <Button size="sm" variant="secondary" onClick={() => manutencao.refetch()}>
                Tentar de novo
              </Button>
            }
          >
            {manutencao.error instanceof ApiError ? `Erro ${manutencao.error.status}.` : 'Verifique sua conexão.'}
          </Alert>
        ) : (
          <BlocoFranquia
            icone={IconTool}
            rotulo="Manutenção"
            usado={manutencao.data.used_minutes}
            limite={manutencao.data.limit_minutes}
            periodoInicio={manutencao.data.period_start}
            periodoFim={manutencao.data.period_end}
            formatar={horasEMinutos}
          />
        )}
      </CardContent>
    </Card>
  )
}
