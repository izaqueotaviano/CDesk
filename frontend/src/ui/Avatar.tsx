const CORES = ['avatar-c1', 'avatar-c2', 'avatar-c3', 'avatar-c4', 'avatar-c5', 'avatar-c6'] as const

/** Determinística: o mesmo nome sempre cai na mesma das 6 cores fixas
 *  (idênticas nos dois temas — DESIGN_SYSTEM.md §1.5, todas AA para texto
 *  branco). Não é aleatório, e não deve variar entre sessões/dispositivos. */
function corPorNome(nome: string): (typeof CORES)[number] {
  const soma = [...nome].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return CORES[soma % CORES.length]
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  const primeira = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? (partes.at(-1)?.[0] ?? '') : ''
  return (primeira + ultima).toUpperCase()
}

interface AvatarProps {
  nome: string
  urlFoto?: string | null
  tamanho?: 'sm' | 'md' | 'lg'
}

const TAMANHO_PX: Record<NonNullable<AvatarProps['tamanho']>, string> = {
  sm: 'h-6 w-6 text-micro',
  md: 'h-8 w-8 text-legenda',
  lg: 'h-11 w-11 text-pequeno',
}

export function Avatar({ nome, urlFoto, tamanho = 'md' }: AvatarProps) {
  if (urlFoto) {
    return (
      <img
        src={urlFoto}
        alt={nome}
        className={`rounded-total object-cover ${TAMANHO_PX[tamanho]}`}
      />
    )
  }
  return (
    <span
      role="img"
      aria-label={nome}
      className={`inline-flex items-center justify-center rounded-total font-medio
        text-white ${TAMANHO_PX[tamanho]}`}
      style={{ backgroundColor: `var(--${corPorNome(nome)})` }}
    >
      {iniciais(nome)}
    </span>
  )
}
