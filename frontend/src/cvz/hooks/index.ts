/**
 * cvzdesk · hooks
 *
 * RECONSTRUÍDO — o MCP cvzdesk expõe componentes, tokens e o DESIGN.md, mas
 * `src/hooks/*` (de onde AppShell/Sidebar/Modal/CommandPalette importam) não
 * é uma pasta de componente e fica fora do que o MCP retorna. As assinaturas
 * abaixo foram inferidas do jeito exato como cada hook é chamado nos
 * componentes portados (`useTheme()` → `{theme, toggle}`, `useFocusTrap(ref,
 * open)`, `useIsMobile()` → boolean) e do que o DESIGN.md descreve em prosa.
 */
import { useEffect, useRef, useState } from 'react'
import { useTemaResolvido } from '@/stores/prefs'

/** Espelha os `$bp-*` do SCSS (`_tokens.scss`) — mesmos valores, um só lugar. */
export const BP = {
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** Abaixo de 768px — sidebar vira gaveta, tabela vira cartão, modal vira folha. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${BP.md - 1}px)`)
}

/** Abaixo de 1024px — cobre mobile + tablet (sidebar em ícones, busca encolhe). */
export function useIsBelowDesktop(): boolean {
  return useMediaQuery(`(max-width: ${BP.lg - 1}px)`)
}

export type Theme = 'light' | 'dark'

/**
 * Tema claro/escuro do shell cvz — hoje uma ADAPTAÇÃO da preferência única do
 * app (`stores/prefs`), não um tema próprio.
 *
 * Era um tema separado: chave `cvz-theme` no localStorage e escrita direta no
 * `data-theme`. Como as telas do shell cvz (/clientes, /configuracoes,
 * /relatorios) são alcançadas pela sidebar do shell Resolv, duas preferências
 * independentes significavam ligar o escuro na topbar e a tela clarear ao
 * navegar. Quem carimba os atributos agora é `aplicarTema` em stores/prefs; a
 * assinatura aqui não mudou, então AppShell/Topbar continuam iguais.
 *
 * O que se perde de propósito: o "sistema" do portal não tem representação
 * neste alternador de dois estados — ele aparece como o valor que estiver na
 * tela, e alternar fixa uma escolha explícita.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const { tema, alternar } = useTemaResolvido()
  return { theme: tema === 'escuro' ? 'dark' : 'light', toggle: alternar }
}

const FOCAVEIS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Prende o Tab dentro de `ref` enquanto `active`; devolve o foco a quem tinha
 * antes de abrir. Usado por Modal, Drawer e CommandPalette — todo overlay que
 * intercepta o teclado sobre o resto da página usa este hook, não reimplementa
 * a lógica (DESIGN.md §1, "Overlay e foco").
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  const anterior = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return
    anterior.current = document.activeElement as HTMLElement | null

    const painel = ref.current
    const focar = () => {
      const alvo = painel?.querySelector<HTMLElement>(FOCAVEIS)
      alvo?.focus()
    }
    // Um tick depois: o painel pode ainda não estar no DOM no mesmo render
    // (Modal/CommandPalette retornam null quando `open` é false).
    const id = window.setTimeout(focar, 0)

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !painel) return
      const itens = Array.from(painel.querySelectorAll<HTMLElement>(FOCAVEIS))
      if (itens.length === 0) return
      const primeiro = itens[0]!
      const ultimo = itens[itens.length - 1]!

      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('keydown', onKeyDown)
      anterior.current?.focus()
    }
  }, [active, ref])
}
