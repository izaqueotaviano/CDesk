const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/**
 * Quando a fila de chat reabre, do jeito que se fala: "hoje às 12:00",
 * "amanhã às 08:00", "na segunda às 08:00" (nesta semana) e "em 12/10 às
 * 08:00" depois disso. Entra depois de "volta"/"abre": "Chat fechado, volta
 * hoje às 12:00". Uma data completa ("30/09/2026 12:00") obrigava a pessoa
 * a conferir se era hoje.
 */
export function quandoReabre(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  const hora = `${p(d.getHours())}:${p(d.getMinutes())}`
  const inicio = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dias = Math.round((inicio(d) - inicio(agora)) / 86_400_000)
  if (dias === 0) return `hoje às ${hora}`
  if (dias === 1) return `amanhã às ${hora}`
  if (dias > 1 && dias < 7) return `${d.getDay() === 0 || d.getDay() === 6 ? 'no' : 'na'} ${DIAS[d.getDay()]} às ${hora}`
  const ano = d.getFullYear() === agora.getFullYear() ? '' : `/${d.getFullYear()}`
  return `em ${p(d.getDate())}/${p(d.getMonth() + 1)}${ano} às ${hora}`
}
