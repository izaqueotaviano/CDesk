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
        neutro: {
          0: '#ffffff', 25: '#fafafa', 50: '#f8f8f7', 100: '#f0f0f0',
          200: '#e6e6e6', 300: '#cfcfcf', 400: '#a8a8a8', 500: '#8d8d8d',
          600: '#7d7d7d', 700: '#4d4d4d', 800: '#35312e', 850: '#24211f',
          875: '#1d1b19', 900: '#1a1a1a', 950: '#171514', 975: '#1a1816',
        },
      },

      fontFamily: {
        ui:      ['Inter', '-apple-system', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'monospace'],
        // Serifa de UM lugar só (saudação da Início), como `--f-display` no console.
        display: ['Libre Baskerville', 'ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif'],
      },

      // escala base 14px razão 1,125
      fontSize: {
        micro:       ['9.75px',  { lineHeight: '1' }],
        legenda:     ['11px',    { lineHeight: '1.45' }],
        pequeno:     ['12.5px',  { lineHeight: '1.45' }],
        corpo:       ['14px',    { lineHeight: '1.45' }],
        'corpo-lg':  ['15.75px', { lineHeight: '1.45' }],
        'titulo-sm': ['17.75px', { lineHeight: '1.25', letterSpacing: '-0.015em' }],
        titulo:      ['20px',    { lineHeight: '1.25', letterSpacing: '-0.015em' }],
        'titulo-lg': ['22.5px',  { lineHeight: '1.25', letterSpacing: '-0.03em' }],
        display:     ['25.25px', { lineHeight: '1.25', letterSpacing: '-0.03em' }],
      },
      fontWeight: { normal: '400', medio: '500', forte: '600' },
      lineHeight: { nenhuma: '1', justa: '1.25', normal: '1.45', solta: '1.6' },
      letterSpacing: { titulo: '-0.015em', display: '-0.03em', nenhum: '0em', rotulo: '0.05em' },

      // grade de 4px com meio-degrau de 2px
      spacing: {
        px: '1px', 1: '4px', 1.5: '6px', 2: '8px', 2.5: '10px',
        3: '12px', 3.5: '14px', 4: '16px', 5: '20px', 6: '24px',
        8: '32px', 10: '40px', 11: '44px', 16: '64px',
        'icone-sm': '12px', 'icone-md': '16px', 'icone-lg': '20px', 'icone-xl': '24px',
        'sidebar-larga': '240px', 'sidebar-recolhida': '64px',
        'alvo-minimo': '24px', 'altura-controle': '34px',
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
