/**
 * Ausência de dado é "—" (valor único) ou "···" (carregando), nunca "0"
 * (DESIGN_SYSTEM.md §7 — voz e tom). Um `0` de verdade deve continuar
 * sendo renderizado como `0`; isto só cobre null/undefined/string vazia.
 */
export function SemDado({
  valor,
  carregando = false,
}: {
  valor: string | number | null | undefined
  carregando?: boolean
}) {
  if (carregando) return <span aria-hidden="true">···</span>
  if (valor === null || valor === undefined || valor === '') {
    return <span aria-label="sem dado">—</span>
  }
  return <>{valor}</>
}
