import { indiceDeIdentidade } from './identidade'

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
      // Cor por hash do nome, o MESMO hash do console do agente (ui/identidade.ts):
      // a pessoa se vê com a cor com que o agente a vê. Tons em
      // styles/tokens.css (DESIGN_SYSTEM.md §1.5), todos AA com texto branco.
      style={{ backgroundColor: `var(--avatar-c${indiceDeIdentidade(nome)})` }}
    >
      {iniciais(nome)}
    </span>
  )
}
