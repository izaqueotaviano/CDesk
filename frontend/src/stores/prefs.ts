import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Tema = 'claro' | 'escuro' | 'sistema'
/** O tema que está REALMENTE na tela — "sistema" já resolvido. */
export type TemaResolvido = 'claro' | 'escuro'
export type Densidade = 'confortavel' | 'compacta'

/** Largura × altura de cada painel do mini chat, em px — um tamanho só para
 *  todos os painéis, escolhido pelo agente (arrasto ou preset). */
export interface TamanhoMiniChat {
  largura: number
  altura: number
}
export const TAMANHOS_MINICHAT = {
  pequeno: { largura: 320, altura: 420 },
  medio: { largura: 380, altura: 500 },
  grande: { largura: 460, altura: 640 },
} as const satisfies Record<string, TamanhoMiniChat>
/** Até onde o arrasto vai — abaixo disso a conversa não cabe, acima cobre a tela. */
export const LIMITES_MINICHAT = {
  largura: [300, 640] as const,
  altura: [360, 800] as const,
}

interface PrefsState {
  tema: Tema
  /** 'compacta' é bit-a-bit o que qualquer tabela do produto já renderiza
   *  hoje sem esta preferência (DataTable.tsx: `density='default'`, 40px;
   *  TicketsTable: 44px fixo) — o padrão aqui PRECISA ser esse mesmo valor.
   *  Até esta preferência ganhar consumidor de verdade ela não tinha efeito
   *  nenhum; a partir de agora tem, e ninguém escolheu nada ainda na
   *  primeira visita — um default diferente do que já está na tela seria
   *  mudar a aparência de toda tabela do admin sem ninguém ter pedido. */
  densidade: Densidade
  /** Sidebar em modo rail (só ícones). Preferência de quem usa, não estado de
   *  tela: quem trabalha em monitor pequeno recolhe uma vez e espera achar
   *  recolhido no dia seguinte — por isso mora aqui, persistido, e não num
   *  `useState` do shell. */
  sidebarRecolhida: boolean
  /** Tamanho dos painéis do mini chat — preferência de conforto de quem atende. */
  miniChat: TamanhoMiniChat
  setTema: (tema: Tema) => void
  setMiniChat: (tamanho: TamanhoMiniChat) => void
  setDensidade: (densidade: Densidade) => void
  alternarSidebar: () => void
}

const CONSULTA_ESCURO = '(prefers-color-scheme: dark)'

/** jsdom e SSR não têm `matchMedia`; sem ele, "sistema" resolve para claro —
 *  que é o padrão dos três design systems. */
export function sistemaPrefereEscuro(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(CONSULTA_ESCURO).matches === true
}

/**
 * O tema é UMA preferência para o app inteiro, e esta função é o único lugar
 * que a carimba no documento. São DOIS atributos porque são três design
 * systems com contratos de CSS diferentes — não três preferências:
 *
 * - `data-tema` ('claro'/'escuro', ou AUSENTE em "sistema") — lido por
 *   styles/tokens.css (portal/legado) e por resolv/styles/tokens.scss. Os dois
 *   têm `@media (prefers-color-scheme)` para o caso ausente, então "sistema" é
 *   justamente não fixar nada e deixar o CSS resolver (inclusive no primeiro
 *   paint, antes de qualquer JS montar).
 * - `data-theme` ('light'/'dark', NUNCA ausente) — lido por
 *   cvz/styles/_theme.scss, que não tem fallback de `prefers-color-scheme`
 *   nenhum. Aqui "sistema" PRECISA ser resolvido em JS: sem isso as telas do
 *   shell cvz (/clientes, /configuracoes, /relatorios) ficariam claras dentro
 *   de um app escuro, e o Popover/Modal do cvz que o shell Resolv reaproveita
 *   desenhariam uma moldura branca em volta de painéis escuros.
 */
function aplicarTema(tema: Tema) {
  const raiz = document.documentElement
  if (tema === 'sistema') raiz.removeAttribute('data-tema')
  else raiz.setAttribute('data-tema', tema)

  const escuro = tema === 'escuro' || (tema === 'sistema' && sistemaPrefereEscuro())
  raiz.setAttribute('data-theme', escuro ? 'dark' : 'light')
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      tema: 'sistema',
      densidade: 'compacta',
      sidebarRecolhida: false,
      miniChat: TAMANHOS_MINICHAT.medio,
      setTema: (tema) => {
        aplicarTema(tema)
        set({ tema })
      },
      setDensidade: (densidade) => set({ densidade }),
      setMiniChat: (miniChat) => set({ miniChat }),
      alternarSidebar: () => set((s) => ({ sidebarRecolhida: !s.sidebarRecolhida })),
    }),
    {
      name: 'resolv:prefs',
      onRehydrateStorage: () => (estado) => {
        if (estado) aplicarTema(estado.tema)
      },
      // Baseline explícita — mesmo motivo de `stores/tabs.ts`: sem version,
      // um formato futuro de `tema`/`densidade` herdaria o localStorage
      // antigo sem chance de migrar.
      version: 1,
    },
  ),
)

// Primeiro carimbo, síncrono no import: a reidratação do zustand cobre quem
// TEM preferência salva, mas quem nunca escolheu nada ficaria sem o
// `data-theme` do cvz até alguém tocar no tema.
if (typeof document !== 'undefined') aplicarTema(usePrefs.getState().tema)

// Quem está em "sistema" acompanha o SO ao vivo. O `data-tema` continua
// ausente (o CSS resolve sozinho), mas o `data-theme` do cvz é fixado em JS e
// precisa ser recarimbado quando o SO troca com a aba aberta.
if (typeof window !== 'undefined') {
  window.matchMedia?.(CONSULTA_ESCURO).addEventListener('change', () => {
    if (usePrefs.getState().tema === 'sistema') aplicarTema('sistema')
  })
}

/**
 * A preferência de tema vista como alternador de dois estados: `tema` é o que
 * está na tela AGORA (com "sistema" já resolvido, para o rótulo do botão não
 * mentir) e `alternar` fixa o oposto do que se vê.
 *
 * Mora aqui, e não no shell, porque os dois botões de tema do produto — o do
 * shell Resolv (resolv/shell/BotaoTema) e o do shell cvz (cvz/hooks::useTheme)
 * — são duas faces da MESMA preferência. O seletor de três posições do portal
 * (portal/configuracoes/SecaoAparencia) continua falando com `setTema` direto,
 * porque lá "sistema" é uma opção de verdade, não um estado intermediário.
 */
export function useTemaResolvido(): {
  tema: TemaResolvido
  alternar: () => void
  /** A PREFERÊNCIA guardada — inclui "sistema", que `tema` já resolveu. */
  preferencia: Tema
  ciclar: () => void
} {
  const preferencia = usePrefs((s) => s.tema)
  const setTema = usePrefs((s) => s.setTema)
  const [sistemaEscuro, setSistemaEscuro] = useState(sistemaPrefereEscuro)

  // Só muda o que está na TELA de quem não escolheu; quem escolheu ignora o SO.
  // O carimbo em si é do `aplicarTema` lá em cima — aqui é só o rótulo.
  useEffect(() => {
    const consulta = window.matchMedia?.(CONSULTA_ESCURO)
    if (!consulta) return
    const aoMudar = (evento: MediaQueryListEvent) => setSistemaEscuro(evento.matches)
    consulta.addEventListener('change', aoMudar)
    return () => consulta.removeEventListener('change', aoMudar)
  }, [])

  const tema: TemaResolvido =
    preferencia === 'sistema' ? (sistemaEscuro ? 'escuro' : 'claro') : preferencia

  const alternar = useCallback(
    () => setTema(tema === 'escuro' ? 'claro' : 'escuro'),
    [tema, setTema],
  )

  // Ciclo de TRÊS posições: claro → escuro → sistema → claro.
  //
  // `alternar` (dois estados) continua existindo para quem já o usa, mas o
  // botão do console passou a usar este. O motivo é simples: o padrão de
  // fábrica é "sistema", e com um alternador de dois estados quem clicasse
  // uma vez ficava preso em claro/escuro para sempre — não havia volta para
  // o automático fora do seletor do portal, que a equipe nem vê.
  const ciclar = useCallback(() => {
    const proxima: Record<Tema, Tema> = { claro: 'escuro', escuro: 'sistema', sistema: 'claro' }
    setTema(proxima[preferencia])
  }, [preferencia, setTema])

  return { tema, alternar, preferencia, ciclar }
}
