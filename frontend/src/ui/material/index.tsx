/**
 * Os componentes oficiais do Google (@material/web) embrulhados para o React 18.
 *
 * Estes wrappers são finos de propósito: quem desenha, anima e trata teclado
 * é o custom element do Material. O que o wrapper acrescenta é só o que o
 * React 18 não faz sozinho — escrever PROPRIEDADE em vez de atributo e ouvir
 * evento customizado (ver `elemento.ts`).
 *
 * O `import` de cada componente fica NESTE arquivo, um a um em vez de
 * `@material/web/all.js`: o pacote inteiro são ~480 KB e estas telas usam
 * seis componentes.
 *
 * Os tipos de cada elemento vêm do próprio pacote, então `ref` e propriedades
 * continuam com tipagem real — nada de `any` solto.
 */
import '@material/web/button/filled-button.js'
import '@material/web/button/outlined-button.js'
import '@material/web/button/text-button.js'
import '@material/web/button/filled-tonal-button.js'
import '@material/web/iconbutton/icon-button.js'
import '@material/web/checkbox/checkbox.js'
import '@material/web/textfield/outlined-text-field.js'
import '@material/web/select/outlined-select.js'
import '@material/web/select/select-option.js'
import '@material/web/divider/divider.js'

import type { MdCheckbox } from '@material/web/checkbox/checkbox.js'
import type { MdOutlinedSelect } from '@material/web/select/outlined-select.js'
import type { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js'
import type { ReactNode } from 'react'
import { useElementoMaterial } from './elemento'
import { SIMBOLOS } from './simbolos'

// Os custom elements não existem no JSX.IntrinsicElements do React 18. A
// declaração fica aqui, num lugar só, em vez de um `@ts-expect-error` por
// call site.
type PropsElemento = Record<string, unknown> & { children?: ReactNode }
declare module 'react' {
  // O React 18 só aceita elemento novo no JSX por aumento de `namespace JSX` —
  // é a forma que o próprio @types/react declara. Não há versão em `module`
  // que funcione aqui; o `namespace` some quando a base subir pro React 19,
  // que reconhece custom element sem declaração nenhuma.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'md-filled-button': PropsElemento
      'md-outlined-button': PropsElemento
      'md-text-button': PropsElemento
      'md-filled-tonal-button': PropsElemento
      'md-icon-button': PropsElemento
      'md-checkbox': PropsElemento
      'md-outlined-text-field': PropsElemento
      'md-outlined-select': PropsElemento
      'md-select-option': PropsElemento
      'md-divider': PropsElemento
    }
  }
}

/* ── Ícone ─────────────────────────────────────────────────────────────────
   Desenho oficial do Material Symbols embutido (ver simbolos.ts). Decorativo
   por padrão: quem dá nome ao controle é o rótulo ou o `aria-label` dele. */
export function Icone({
  nome,
  tamanho = 18,
  className,
  slot,
}: {
  nome: string
  tamanho?: number
  className?: string
  slot?: string
}) {
  const d = SIMBOLOS[nome]
  if (!d) return null
  const svg = (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={tamanho}
      height={tamanho}
      fill="currentColor"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <path d={d} />
    </svg>
  )
  // `slot` existe em HTMLAttributes mas não em SVGAttributes (React 18), daí
  // o <span> quando o ícone vai para um slot do componente Material. O span
  // não muda nada no desenho: o slot aceita qualquer elemento.
  return slot ? (
    <span slot={slot} style={{ display: 'flex' }}>
      {svg}
    </span>
  ) : (
    svg
  )
}

/* ── Botões ──────────────────────────────────────────────────────────────── */

type PropsBotao = {
  children?: ReactNode
  /** filled = ação principal · tonal = alternativa de destaque ·
   *  outlined = secundária · text = ênfase baixa */
  variante?: 'filled' | 'tonal' | 'outlined' | 'text'
  icone?: string
  /** Ícone DEPOIS do rótulo. O slot do Material é o mesmo (`icon`); o que
   *  muda o lado é o atributo `trailing-icon` no próprio componente. */
  iconeFinal?: string
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  title?: string
  'aria-label'?: string
}

export function Botao({
  children,
  variante = 'outlined',
  icone,
  iconeFinal,
  onClick,
  disabled,
  type = 'button',
  className,
  title,
  'aria-label': ariaLabel,
}: PropsBotao) {
  const ref = useElementoMaterial<HTMLElement>({ disabled: !!disabled })
  const Tag = (
    {
      filled: 'md-filled-button',
      tonal: 'md-filled-tonal-button',
      outlined: 'md-outlined-button',
      text: 'md-text-button',
    } as const
  )[variante]
  return (
    <Tag
      ref={ref}
      type={type}
      class={className}
      title={title}
      aria-label={ariaLabel}
      trailing-icon={iconeFinal ? '' : undefined}
      onClick={disabled ? undefined : onClick}
    >
      {(icone || iconeFinal) && <Icone nome={(icone ?? iconeFinal) as string} slot="icon" />}
      {children}
    </Tag>
  )
}

export function BotaoIcone({
  icone,
  onClick,
  disabled,
  className,
  title,
  'aria-label': ariaLabel,
}: {
  icone: string
  onClick?: () => void
  disabled?: boolean
  className?: string
  title?: string
  'aria-label': string
}) {
  const ref = useElementoMaterial<HTMLElement>({ disabled: !!disabled })
  return (
    <md-icon-button
      ref={ref}
      type="button"
      class={className}
      title={title}
      aria-label={ariaLabel}
      onClick={disabled ? undefined : onClick}
    >
      <Icone nome={icone} tamanho={19} />
    </md-icon-button>
  )
}

/* ── Campo de texto ──────────────────────────────────────────────────────── */

export function Campo({
  value,
  onChange,
  label,
  placeholder,
  erro,
  textoErro,
  textoApoio,
  icone,
  acaoFinal,
  className,
  type = 'text',
  somenteLeitura,
  title,
  'aria-disabled': ariaDisabled,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (valor: string) => void
  label?: string
  placeholder?: string
  erro?: boolean
  textoErro?: string
  textoApoio?: string
  icone?: string
  /** Conteúdo do slot final (um botão de limpar, por exemplo). */
  acaoFinal?: ReactNode
  className?: string
  type?: string
  /** Campo focalizável mas não editável — o "em breve" que continua na ordem
   *  de tabulação (`disabled` sairia dela e levaria a explicação junto). */
  somenteLeitura?: boolean
  title?: string
  'aria-disabled'?: 'true'
  'aria-label'?: string
}) {
  // `value` é propriedade, não atributo: escrito como atributo o campo só
  // aceitaria o valor inicial e ignoraria toda atualização vinda do estado.
  const ref = useElementoMaterial<MdOutlinedTextField>(
    { value, error: !!erro, errorText: textoErro ?? '', readOnly: !!somenteLeitura },
    // `input` é a tecla; `change` é o commit (blur, autofill, limpar). Os dois
    // leem a mesma propriedade, então ouvir os dois é idempotente — e sem o
    // `change` um valor colado sem digitação não chegaria ao estado.
    {
      input: (e) => onChange((e.target as MdOutlinedTextField).value),
      change: (e) => onChange((e.target as MdOutlinedTextField).value),
    },
  )
  return (
    <md-outlined-text-field
      ref={ref}
      class={className}
      type={type}
      label={label}
      title={title}
      placeholder={placeholder}
      readonly={somenteLeitura ? '' : undefined}
      aria-label={ariaLabel}
      aria-disabled={ariaDisabled}
      supporting-text={textoApoio}
    >
      {icone && <Icone nome={icone} slot="leading-icon" />}
      {acaoFinal}
    </md-outlined-text-field>
  )
}

/* ── Select ──────────────────────────────────────────────────────────────── */

export function Select({
  value,
  onChange,
  label,
  opcoes,
  disabled,
  className,
  title,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (valor: string) => void
  label?: string
  opcoes: { valor: string; rotulo: string }[]
  disabled?: boolean
  className?: string
  title?: string
  'aria-label'?: string
}) {
  const ref = useElementoMaterial<MdOutlinedSelect>(
    { value, disabled: !!disabled },
    { change: (e) => onChange((e.target as MdOutlinedSelect).value) },
  )
  return (
    <md-outlined-select
      ref={ref}
      class={className}
      label={label}
      title={title}
      aria-label={ariaLabel}
    >
      {opcoes.map((o) => (
        <md-select-option key={o.valor} value={o.valor}>
          <div slot="headline">{o.rotulo}</div>
        </md-select-option>
      ))}
    </md-outlined-select>
  )
}

/* ── Caixa de seleção ────────────────────────────────────────────────────── */

export function Caixa({
  checked,
  indeterminate,
  onChange,
  className,
  title,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (marcado: boolean) => void
  className?: string
  title?: string
  'aria-label': string
}) {
  // `indeterminate` só existe como propriedade — é o estado "parte da página
  // marcada" da caixa do cabeçalho da tabela.
  const ref = useElementoMaterial<MdCheckbox>(
    { checked, indeterminate: !!indeterminate },
    { change: (e) => onChange((e.target as MdCheckbox).checked) },
  )
  return (
    <md-checkbox
      ref={ref}
      class={className}
      title={title}
      aria-label={ariaLabel}
      touch-target="wrapper"
    />
  )
}
