import { useId, type ReactNode } from 'react'
import type { Icon } from '@tabler/icons-react'
import { ESCALA_DO_TEXTO, usePrefs, type TamanhoTexto } from '@/stores/prefs'
import { cn } from '../lib/cn'

/**
 * Peças das telas de preferência (Configurações do portal e Minha conta do
 * console): o seletor segmentado, a linha rótulo + controle e o seletor de
 * tamanho do texto, que as duas telas mostram igual.
 */

export interface OpcaoSegmentada<T extends string | number> {
  valor: T
  rotulo: string
  icone?: Icon
  /** Desenho no lugar do ícone — a amostra "Aa" do tamanho do texto. */
  amostra?: ReactNode
}

/**
 * Rádios nativos com cara de seletor segmentado: as setas do teclado andam
 * entre as opções e o leitor de tela anuncia "2 de 3" sem nenhum código
 * nosso (o mesmo motivo do seletor de formato da assinatura). A opção
 * escolhida é a única com fundo de cartão, borda e peso; as outras ficam no
 * tom do plano. Aplicar é imediato: não há "salvar" numa preferência de
 * tela, a pessoa vê o efeito na própria página.
 */
export function Segmentado<T extends string | number>({
  opcoes,
  valor,
  onMudar,
  rotuladoPor,
  rotulo,
  className,
}: {
  opcoes: OpcaoSegmentada<T>[]
  valor: T
  onMudar: (valor: T) => void
  /** id do texto que dá nome ao grupo (o rótulo da linha); ou `rotulo`. */
  rotuladoPor?: string
  rotulo?: string
  className?: string
}) {
  const nome = useId()
  return (
    <div
      role="radiogroup"
      aria-labelledby={rotuladoPor}
      aria-label={rotuladoPor ? undefined : rotulo}
      className={cn('inline-flex max-w-full flex-wrap gap-1 rounded-md bg-navegacao p-1', className)}
    >
      {opcoes.map((o) => (
        <label
          key={String(o.valor)}
          className={cn(
            'inline-flex min-h-8 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-sm border border-transparent px-3 py-1 text-corpo leading-tight text-tinta-secundaria transition-colors hover:text-tinta motion-reduce:transition-none',
            'has-[:checked]:border-borda-controle has-[:checked]:bg-superficie has-[:checked]:font-medio has-[:checked]:text-tinta',
            // O rádio é `sr-only`: o contorno global de :focus-visible cai
            // nele e fica invisível, então é o rótulo que desenha o foco. Em
            // propriedade arbitrária porque o tailwind-merge (`cn`) lê
            // `outline` como largura e o descartava junto do `outline-2`.
            'has-[:focus-visible]:[outline:2px_solid_var(--foco)] has-[:focus-visible]:[outline-offset:2px]',
          )}
        >
          <input
            type="radio"
            name={nome}
            className="sr-only"
            checked={valor === o.valor}
            onChange={() => onMudar(o.valor)}
          />
          {o.amostra ?? (o.icone && <o.icone className="size-4 shrink-0" stroke={1.75} aria-hidden="true" />)}
          {o.rotulo}
        </label>
      ))}
    </div>
  )
}

/**
 * Uma linha de ajuste: o que é (e para que serve) à esquerda, o controle à
 * direita. No celular o controle desce para baixo do texto, em vez de
 * espremer as duas colunas.
 */
export function LinhaDeAjuste({
  id,
  titulo,
  descricao,
  children,
}: {
  /** id do título: é por ele que o controle ganha nome acessível. */
  id: string
  titulo: string
  descricao?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="min-w-0 md:max-w-[46%]">
        <p id={id} className="text-corpo font-medio text-tinta">
          {titulo}
        </p>
        {descricao && <p className="mt-0.5 text-pequeno text-tinta-secundaria">{descricao}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const TAMANHOS: { valor: TamanhoTexto; rotulo: string }[] = [
  { valor: 'padrao', rotulo: 'Padrão' },
  { valor: 'grande', rotulo: 'Grande' },
  { valor: 'maior', rotulo: 'Maior' },
]

/**
 * Padrão / Grande / Maior. A amostra "Aa" de cada opção é desenhada no
 * tamanho que aquela opção produz, em px no `style` (que a escala do texto
 * não alcança: ela só reescreve o CSS). Assim as três amostras ficam iguais
 * seja qual for a escolha atual, e comparar continua honesto.
 */
export function SeletorTamanhoTexto({ rotuladoPor }: { rotuladoPor: string }) {
  const tamanho = usePrefs((s) => s.tamanhoTexto)
  const setTamanho = usePrefs((s) => s.setTamanhoTexto)
  return (
    <Segmentado
      rotuladoPor={rotuladoPor}
      valor={tamanho}
      onMudar={setTamanho}
      opcoes={TAMANHOS.map((t) => ({
        ...t,
        amostra: (
          <span
            aria-hidden="true"
            className="font-forte leading-none"
            style={{ fontSize: `${ESCALA_DO_TEXTO[t.valor] * 14}px` }}
          >
            Aa
          </span>
        ),
      }))}
    />
  )
}
