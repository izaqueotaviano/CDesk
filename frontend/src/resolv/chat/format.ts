/** "há 3 min" / "há 2h" / "agora" — relativo a um instante de referência
 *  (não `Date.now()` em render: quem chama passa o "agora" que quiser). */
export function haQuanto(iso: string | null, agoraMs: number): string {
  if (!iso) return '—'
  const diff = agoraMs - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

/** "14:32" — hora de uma mensagem. */
export function horaDe(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** "04/09/2026 14:32" */
export function dataHoraDe(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Faixa de dia entre mensagens: "Hoje", "Ontem", ou a data. */
export function rotuloDoDia(iso: string, agoraMs: number): string {
  const d = new Date(iso)
  const hoje = new Date(agoraMs)
  const mesmoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (mesmoDia(d, hoje)) return 'Hoje'
  const ontem = new Date(agoraMs - 86_400_000)
  if (mesmoDia(d, ontem)) return 'Ontem'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p.at(-1)?.[0] ?? '') : '')).toUpperCase()
}
