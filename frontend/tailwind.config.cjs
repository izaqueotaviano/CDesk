/**
 * resolv — tailwind.config.js
 *
 * theme.extend, não theme: a escala padrão do Tailwind continua disponível.
 * Os valores apontam para as variáveis de tokens.css, então trocar o tema
 * pelo atributo data-tema continua funcionando sem recompilar.
 *
 * Importe tokens.css antes das diretivas do Tailwind.
 *
 * `content` não veio no arquivo original entregue (docs/design-system/) —
 * acrescentado aqui porque o Tailwind v3 não gera NADA sem ele.
 */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],

  darkMode: ['variant', [
    '&:where([data-tema="escuro"], [data-tema="escuro"] *)',
    '@media (prefers-color-scheme: dark) { &:where(:not([data-tema="claro"]) *) }',
  ]],

  theme: {
    extend: {
      colors: {
        // semânticos — seguem o tema
        canvas:      'var(--canvas)',
        superficie: {
          DEFAULT: 'var(--superficie)',
          sutil:   'var(--superficie-sutil)',
          elevada: 'var(--superficie-elevada)',
        },
        navegacao:   'var(--navegacao)',
        divisoria:   'var(--divisoria)',
        'borda-controle': 'var(--borda-controle)',
        // Linha de CAMPO (input/select/textarea) — mais escura que a
        // estrutural, como no console (`--borda-campo` / `$border-field`).
        'borda-campo': 'var(--borda-campo)',
        tinta: {
          DEFAULT:     'var(--tinta)',
          secundaria:  'var(--tinta-secundaria)',
          terciaria:   'var(--tinta-terciaria)',
          cromo:       'var(--texto-cromo)',
        },
        acento: {
          DEFAULT: 'var(--acento)',
          hover:   'var(--acento-hover)',
          suave:   'var(--acento-suave)',
          sobre:   'var(--acento-sobre)',
        },
        perigo: { DEFAULT: 'var(--perigo)', suave: 'var(--perigo-suave)' },
        alerta: { DEFAULT: 'var(--alerta)', suave: 'var(--alerta-suave)' },
        ok:     { DEFAULT: 'var(--ok)',     suave: 'var(--ok-suave)' },
        sobreposicao: 'var(--sobreposicao)',

        // primitivos — use só quando o valor não puder seguir o tema.
        // A rampa é a do console (ver tokens.css); a quente antiga saiu.
        // 800/850/875/950/975 (degraus escuros) pelos roles de escala do
        // Material 3 — têm que ficar IDÊNTICOS aos mesmos primitivos em
        // src/styles/tokens.css (--neutro-*), que é quem documenta o porquê.
        neutro: {
          0: '#ffffff', 25: '#fafafa', 50: '#f8f8f7', 100: '#f0f0f0',
          200: '#e6e6e6', 300: '#cfcfcf', 400: '#a8a8a8', 500: '#8d8d8d',
          600: '#7d7d7d', 700: '#4d4d4d', 800: '#50453a', 850: '#241f1a',
          875: '#201b16', 900: '#1a1a1a', 950: '#120d09', 975: '#17130e',
        },
      },

      // Roboto é a fonte do Material 3. `display` não é mais serifa: o M3 faz
      // destaque com a MESMA família num corpo maior — o nome fica porque
      // `font-display` aparece em algumas telas.
      fontFamily: {
        ui:      ['Roboto', 'Inter', '-apple-system', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'monospace'],
        display: ['Roboto', 'Inter', '-apple-system', 'system-ui', 'sans-serif'],
      },

      // A escala do Material 3, com o topo podado (ver md3.css). Tamanho,
      // entrelinha e tracking andam juntos porque no M3 eles são UM degrau.
      // Têm que ficar IDÊNTICOS aos --md-fs-*/--md-lh-*/--md-ls-* de md3.css.
      fontSize: {
        micro:       ['11px', { lineHeight: '16px', letterSpacing: '0.04545em' }], // label-small
        legenda:     ['12px', { lineHeight: '16px', letterSpacing: '0.03333em' }], // body-small
        pequeno:     ['12px', { lineHeight: '16px', letterSpacing: '0.03333em' }],
        corpo:       ['14px', { lineHeight: '20px', letterSpacing: '0.01786em' }], // body-medium
        'corpo-lg':  ['16px', { lineHeight: '24px', letterSpacing: '0.03125em' }], // body-large
        'titulo-sm': ['16px', { lineHeight: '24px', letterSpacing: '0.009375em' }], // title-medium
        titulo:      ['22px', { lineHeight: '28px', letterSpacing: '0em' }],        // title-large
        'titulo-lg': ['24px', { lineHeight: '32px', letterSpacing: '0em' }],        // headline-small
        display:     ['24px', { lineHeight: '32px', letterSpacing: '0em' }],
      },
      fontWeight: { normal: '400', medio: '500', forte: '600' },
      lineHeight: { nenhuma: '1', justa: '1.27', normal: '1.43', solta: '1.6' },
      letterSpacing: { titulo: '0em', display: '0em', nenhum: '0em', rotulo: '0.04167em' },

      // grade de 4px com meio-degrau de 2px
      spacing: {
        px: '1px', 1: '4px', 1.5: '6px', 2: '8px', 2.5: '10px',
        3: '12px', 3.5: '14px', 4: '16px', 5: '20px', 6: '24px',
        8: '32px', 10: '40px', 11: '44px', 16: '64px',
        'icone-sm': '16px', 'icone-md': '18px', 'icone-lg': '20px', 'icone-xl': '24px',
        'sidebar-larga': '240px', 'sidebar-recolhida': '64px',
        // Alturas do briefing: 36 / 40 / 44. Espelham --control-height-* de md3.css.
        'alvo-minimo': '36px', 'altura-controle': '40px', 'altura-controle-lg': '44px',
        'respiro-painel': 'var(--respiro-painel)',
      },

      // Um raio só (2px) — sm/md/lg/xl continuam existindo por NOME porque
      // 50 arquivos os usam, mas todos resolvem pro mesmo valor (tokens.css).
      // `total` é forma (avatar, interruptor, ponto), não estilo; `painel` é
      // a exceção do shell, como `--raio-painel` no console.
      borderRadius: {
        sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)', xl: 'var(--r-xl)',
        total: 'var(--r-total)', painel: 'var(--r-painel)',
      },
      borderWidth:  { DEFAULT: '1px', fina: '1px' },

      boxShadow: {
        'elevacao-1': 'var(--elevacao-1)',
        'elevacao-3': 'var(--elevacao-3)',
        foco:    '0 0 0 1px var(--acento)',
        erro:    '0 0 0 1px var(--perigo)',
        interno: 'inset 0 0 0 1px currentColor',
      },

      transitionDuration:       { DEFAULT: '150ms', padrao: '150ms' },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(.2,0,.38,.9)', padrao: 'cubic-bezier(.2,0,.38,.9)' },

      zIndex: {
        suspenso: '100', fixo: '200', cortina: '300',
        modal: '400', popover: '500', toast: '600',
      },

      backgroundImage: { esqueleto: 'var(--esqueleto)' },

      // altura mínima de alvo — WCAG 2.5.8
      minHeight: { alvo: '24px', controle: '32px' },
      minWidth:  { alvo: '24px' },
    },
  },

  plugins: [],
};
