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
const THEME_KEY = 'cvz-theme'

function temaInicial(): Theme {
  try {
    const salvo = localStorage.getItem(THEME_KEY)
    if (salvo === 'light' || salvo === 'dark') return salvo
  } catch {
    // localStorage indisponível (modo privado, preview sem storage) — cai
    // no prefers-color-scheme abaixo, nunca quebra a leitura do tema.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Tema claro/escuro — o atributo `data-theme` no `<html>`, persistido em
 * localStorage. É uma ESCOLHA explícita (o botão sol/lua da Topbar), não um
 * terceiro estado "sistema": a preferência do SO só decide o valor inicial.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(temaInicial)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // melhor esforço — tema ainda funciona na aba atual sem persistir
    }
  }, [theme])

  return {
    theme,
    toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
  }
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
