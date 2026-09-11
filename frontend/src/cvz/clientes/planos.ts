import type { IdentityTone } from '@/cvz/components'
import { indiceDoPlano } from '@/ui/planos'

/**
 * Tom do selo de plano na lista de empresas. Antes era `tone="blue"` fixo —
 * Black, Gold e Platinum eram o mesmo selo, e a lista não separava um do
 * outro sem ler o texto. A escolha do tom mora em ui/planos.ts, compartilhada
 * com o chip de plano do painel do cliente (resolv): mesma cor nas duas telas.
 */
export function toneDoPlano(nome: string | null | undefined): IdentityTone {
  return `identity-${indiceDoPlano(nome)}`
}
