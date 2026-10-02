import { useState } from 'react'
import { indiceDeIdentidade } from './identidade'

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  const primeira = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? (partes.at(-1)?.[0] ?? '') : ''
  return (primeira + ultima).toUpperCase()
}

export type Presenca = 'available' | 'away' | 'offline'

interface AvatarProps {
  nome: string
  urlFoto?: string | null
  tamanho?: 'sm' | 'md' | 'lg'
  /** Disponibilidade — desenha a bolinha no canto. Sem isto, nada é desenhado:
   *  uma bolinha cinza "por padrão" afirmaria "offline" sobre quem o sistema
   *  simplesmente não sabe. */
  presenca?: Presenca | null
  /** Cor de fundo do container, para o recorte da bolinha. O padrão serve à
   *  superfície de cartão, que é onde o avatar mais aparece. */
  fundo?: 'superficie' | 'navegacao' | 'canvas'
}

const TAMANHO_PX: Record<NonNullable<AvatarProps['tamanho']>, string> = {
  sm: 'h-6 w-6 text-micro',
  md: 'h-8 w-8 text-legenda',
  lg: 'h-11 w-11 text-pequeno',
}

/** ~1/3 do avatar. Menor que isto vira sujeira na tela em vez de sinal. */
const PONTO_PX: Record<NonNullable<AvatarProps['tamanho']>, string> = {
  sm: 'size-2.5',
  md: 'size-3',
  lg: 'size-3.5',
}

const COR_DA_PRESENCA: Record<Presenca, string> = {
  available: 'bg-ok',
  away: 'bg-alerta',
  offline: 'bg-tinta-terciaria',
}

const ROTULO_DA_PRESENCA: Record<Presenca, string> = {
  available: 'disponível',
  away: 'ausente',
  offline: 'offline',
}

const COR_DO_FUNDO: Record<NonNullable<AvatarProps['fundo']>, string> = {
  superficie: 'ring-superficie',
  navegacao: 'ring-navegacao',
  canvas: 'ring-canvas',
}

/**
 * A bolinha de estado, no canto inferior direito.
 *
 * O recorte é um `ring` de 2px na cor do CONTAINER — é ele que separa a
 * bolinha do avatar sem depender de contraste entre as duas cores, que
 * mudam as duas (o avatar tem seis tons de identidade, e o fundo muda com
 * o tema).
 */
export function PontoDePresenca({
  presenca,
  tamanho = 'md',
  fundo = 'superficie',
}: {
  presenca: Presenca
  tamanho?: NonNullable<AvatarProps['tamanho']>
  fundo?: NonNullable<AvatarProps['fundo']>
}) {
  return (
    <span
      className={`absolute -bottom-px -right-px rounded-total ring-2 ${PONTO_PX[tamanho]} ${COR_DA_PRESENCA[presenca]} ${COR_DO_FUNDO[fundo]}`}
      aria-hidden="true"
    />
  )
}

export function Avatar({
  nome,
  urlFoto,
  tamanho = 'md',
  presenca,
  fundo = 'superficie',
}: AvatarProps) {
  // Foto que não carrega (link quebrado, 404) cai nas iniciais em vez de
  // deixar o ícone de imagem quebrada do navegador com o `alt` vazando ao
  // lado. Guarda a URL que falhou, não um booleano: se a foto trocar, a nova
  // tenta de novo.
  const [urlQuebrada, setUrlQuebrada] = useState<string | null>(null)
  // O texto acessível carrega o estado junto: quem não vê a bolinha precisa
  // da informação, e um `aria-hidden` no ponto sem isto a apagaria.
  const rotulo = presenca ? `${nome}, ${ROTULO_DA_PRESENCA[presenca]}` : nome

  if (urlFoto && urlQuebrada !== urlFoto) {
    return (
      <span className="relative inline-flex shrink-0">
        <img
          src={urlFoto}
          alt={rotulo}
          className={`rounded-total object-cover ${TAMANHO_PX[tamanho]}`}
          onError={() => setUrlQuebrada(urlFoto)}
        />
        {presenca && <PontoDePresenca presenca={presenca} tamanho={tamanho} fundo={fundo} />}
      </span>
    )
  }
  return (
    <span
      role="img"
      aria-label={rotulo}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-total font-medio
        text-white ${TAMANHO_PX[tamanho]}`}
      // Cor por hash do nome, o MESMO hash do console do agente (ui/identidade.ts):
      // a pessoa se vê com a cor com que o agente a vê. Tons em
      // styles/tokens.css (DESIGN_SYSTEM.md §1.5), todos AA com texto branco.
      style={{ backgroundColor: `var(--avatar-c${indiceDeIdentidade(nome)})` }}
    >
      {iniciais(nome)}
      {presenca && <PontoDePresenca presenca={presenca} tamanho={tamanho} fundo={fundo} />}
    </span>
  )
}
