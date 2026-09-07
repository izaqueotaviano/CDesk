import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

// ---------------------------------------------------------------------------
// Franquia de manutenção — irmã da cota de tickets (`me.quota`, já embutida
// em `/auth/me/`), mas com endpoint PRÓPRIO: são dois períodos diferentes
// (apps/customers/views.py: MaintenanceView), então não dá pra reaproveitar
// a mesma leitura de sessão.
// ---------------------------------------------------------------------------

export interface FranquiaManutencao {
  used_minutes: number
  limit_minutes: number | null
  period_start: string
  period_end: string
}

export function useFranquiaManutencao() {
  return useQuery({
    queryKey: ['portal', 'manutencao'],
    queryFn: () => api.get<FranquiaManutencao>('/api/v1/maintenance/'),
    staleTime: 60_000,
  })
}
