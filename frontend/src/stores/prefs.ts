import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Tema = 'claro' | 'escuro' | 'sistema'
/** O tema que está REALMENTE na tela — "sistema" já resolvido. */
export type TemaResolvido = 'claro' | 'escuro'
export type Densidade = 'confortavel' | 'compacta'

/**
 * Tamanho do texto — o fator que `aplicarTamanhoTexto` carimba em
 * `--escala-texto` e que `postcss-escala-texto.js` multiplica em todo
 * `font-size` do app. Dois degraus acima do padrão, e não um controle
 * contínuo: quem precisa de texto maior quer escolher entre poucas opções
 * que já foram vistas funcionando (sidebar, tabelas e conversa conferidas
 * nos três), não achar sozinho o número que não quebra a tela.
 */
export type TamanhoTexto = 'padrao' | 'grande' | 'maior'
export const ESCALA_DO_TEXTO: Record<TamanhoTexto, number> = {
  padrao: 1,
  grande: 1.125,
  maior: 1.25,
}

/** Minutos sem atividade até a presença virar "Ausente" sozinha; 0 = nunca.
 *  Ver resolv/shell/ausenciaAutomatica.ts. */
export type MinutosAusencia = 0 | 5 | 10 | 15 | 30
export const OPCOES_AUSENCIA: readonly MinutosAusencia[] = [5, 10, 15, 30, 0]

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
  /** As três de baixo também moram na conta (`/auth/me/`); a cópia daqui é
   *  para a primeira pintura e para quem ainda não carregou o `me`. Quem
   *  leva de um lado para o outro é `stores/sincronizarPrefs.ts`. */
  tamanhoTexto: TamanhoTexto
  /** Bipe dos avisos em segundo plano (realtime/avisos.ts). */
  somNotificacoes: boolean
  ausenciaAutomatica: MinutosAusencia
  setTema: (tema: Tema) => void
  setMiniChat: (tamanho: TamanhoMiniChat) => void
  setDensidade: (densidade: Densidade) => void
  setTamanhoTexto: (tamanho: TamanhoTexto) => void
  setSomNotificacoes: (ligado: boolean) => void
  setAusenciaAutomatica: (minutos: MinutosAusencia) => void
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
  pintarBarraDoNavegador(tema)
}

/** A cor do plano (`--canvas` em styles/tokens.css) nos dois temas. */
const COR_DA_BARRA = { claro: '#f6f5f3', escuro: '#1a1a19' } as const

/**
 * A barra do navegador no celular (`<meta name="theme-color">` do index.html)
 * segue a mesma escolha: com o tema forçado, os dois metas levam a cor dele,
 * senão a barra ficaria clara num app escuro. Em "sistema", cada meta volta
 * à cor do seu `media`.
 */
function pintarBarraDoNavegador(tema: Tema) {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const doMeta = meta.media.includes('dark') ? 'escuro' : 'claro'
    meta.content = COR_DA_BARRA[tema === 'sistema' ? doMeta : tema]
  }
}

/**
 * Mesmo papel do `aplicarTema` para o tamanho do texto: o único lugar que o
 * carimba no documento. A variável é o que o CSS lê (via
 * postcss-escala-texto.js); o atributo é só para quem precisa saber o nível
 * sem fazer conta (teste, e CSS pontual que queira reagir a "texto grande").
 * No padrão os dois SAEM, em vez de ficarem valendo 1: o <html> de quem
 * nunca mexeu nisso fica igual ao de antes da preferência existir.
 */
function aplicarTamanhoTexto(tamanho: TamanhoTexto) {
  const raiz = document.documentElement
  if (tamanho === 'padrao') {
    raiz.style.removeProperty('--escala-texto')
    raiz.removeAttribute('data-tamanho-texto')
    return
  }
  raiz.style.setProperty('--escala-texto', String(ESCALA_DO_TEXTO[tamanho]))
  raiz.setAttribute('data-tamanho-texto', tamanho)
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      tema: 'sistema',
      densidade: 'compacta',
      sidebarRecolhida: false,
      miniChat: TAMANHOS_MINICHAT.medio,
      tamanhoTexto: 'padrao',
      // ligado: é o comportamento de antes desta preferência existir
      somNotificacoes: true,
      ausenciaAutomatica: 15,
      setTema: (tema) => {
        aplicarTema(tema)
        set({ tema })
      },
      setDensidade: (densidade) => set({ densidade }),
      setMiniChat: (miniChat) => set({ miniChat }),
      setTamanhoTexto: (tamanhoTexto) => {
        aplicarTamanhoTexto(tamanhoTexto)
        set({ tamanhoTexto })
      },
      setSomNotificacoes: (somNotificacoes) => set({ somNotificacoes }),
      setAusenciaAutomatica: (ausenciaAutomatica) => set({ ausenciaAutomatica }),
      alternarSidebar: () => set((s) => ({ sidebarRecolhida: !s.sidebarRecolhida })),
    }),
    {
      name: 'resolv:prefs',
      onRehydrateStorage: () => (estado) => {
        if (!estado) return
        aplicarTema(estado.tema)
        aplicarTamanhoTexto(estado.tamanhoTexto ?? 'padrao')
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
if (typeof document !== 'undefined') {
  aplicarTema(usePrefs.getState().tema)
  aplicarTamanhoTexto(usePrefs.getState().tamanhoTexto)
}

// Outra aba mudou uma preferência: esta relê o localStorage e se ajusta na
// hora. Sem isto, quem aumenta o texto em Minha conta via as outras abas
// abertas no tamanho antigo até dar F5 — e o bipe desligado continuava
// tocando nelas. O evento `storage` só dispara nas OUTRAS abas.
//
// A marca `vindoDeOutraAba` existe para a sincronização com o servidor
// (stores/sincronizarPrefs.ts) não gravar de novo o que a outra aba já
// gravou: com localStorage a reidratação é síncrona, então a marca cobre
// exatamente o `set` que ela provoca.
let vindoDeOutraAba = false

export function mudancaVeioDeOutraAba(): boolean {
  return vindoDeOutraAba
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (evento) => {
    if (evento.key !== 'resolv:prefs') return
    // Com localStorage o `rehydrate` do zustand roda inteiro nesta mesma
    // pilha (o "thenable" que ele devolve é síncrono), então desligar a marca
    // logo depois cobre todo `set` que ele provoca.
    vindoDeOutraAba = true
    try {
      void usePrefs.persist.rehydrate()
    } finally {
      vindoDeOutraAba = false
    }
  })
}

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
  /** Para onde `ciclar` vai — é o que o rótulo do botão anuncia. */
  proxima: Tema
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

  // `alternar` (dois estados) continua existindo para quem já o usa; os
  // botões de tema usam este. Ver `proximaPreferencia`.
  const proxima = proximaPreferencia(preferencia, sistemaEscuro)
  const ciclar = useCallback(() => setTema(proxima), [proxima, setTema])

  return { tema, alternar, preferencia, ciclar, proxima }
}

/**
 * Para onde o botão de tema vai a seguir. Duas regras:
 *
 * 1. TODO clique muda o que está na tela. O ciclo fixo claro → escuro →
 *    sistema tinha um clique morto: no padrão de fábrica ("sistema") num
 *    computador claro, o primeiro clique ia para "claro" e nada mudava — com
 *    o rótulo "Usar tema claro" em cima de uma tela já clara.
 * 2. "Sistema" continua alcançável. Com um alternador de dois estados, quem
 *    clicasse uma vez ficava preso em claro/escuro para sempre.
 *
 * Então: em "sistema", vai para o oposto do que se vê; numa escolha fixa,
 * volta para "sistema" se isso mudar a tela, e senão vai para o outro fixo.
 * Num computador claro isso dá sistema → escuro → sistema…; "claro" fixo só
 * se alcança pelo seletor do portal, e na tela ele é igual ao automático.
 */
export function proximaPreferencia(preferencia: Tema, sistemaEscuro: boolean): Tema {
  const doSistema: TemaResolvido = sistemaEscuro ? 'escuro' : 'claro'
  if (preferencia === 'sistema') return doSistema === 'escuro' ? 'claro' : 'escuro'
  if (doSistema !== preferencia) return 'sistema'
  return preferencia === 'claro' ? 'escuro' : 'claro'
}

/** O rótulo do botão anuncia a PRÓXIMA ação, não o estado atual — "Tema
 *  claro" seria ambíguo: é o que está ligado ou o que vou ligar? */
export const ACAO_DO_TEMA: Record<Tema, string> = {
  claro: 'Usar tema claro',
  escuro: 'Usar tema escuro',
  sistema: 'Acompanhar o sistema',
}
