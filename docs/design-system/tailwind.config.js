/**
 * resolv — tailwind.config.js
 *
 * theme.extend, não theme: a escala padrão do Tailwind continua disponível.
 * Os valores apontam para as variáveis de tokens.css, então trocar o tema
 * pelo atributo data-tema continua funcionando sem recompilar.
 *
 * Importe tokens.css antes das diretivas do Tailwind.
 */
module.exports = {
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
        tinta: {
          DEFAULT:     'var(--tinta)',
          secundaria:  'var(--tinta-secundaria)',
          terciaria:   'var(--tinta-terciaria)',
        },
        acento: {
          DEFAULT: 'var(--acento)',
          suave:   'var(--acento-suave)',
          sobre:   'var(--acento-sobre)',
        },
        perigo: { DEFAULT: 'var(--perigo)', suave: 'var(--perigo-suave)' },
        alerta: { DEFAULT: 'var(--alerta)', suave: 'var(--alerta-suave)' },
        ok:     { DEFAULT: 'var(--ok)',     suave: 'var(--ok-suave)' },

        // primitivos — use só quando o valor não puder seguir o tema
        neutro: {
          0: '#ffffff', 25: '#fffbf8', 50: '#f8f4f1', 100: '#f1ece8',
          200: '#e8e2dd', 300: '#c9c0ba', 400: '#a79e97', 500: '#9a918a',
          600: '#79706a', 700: '#635c57', 800: '#3b3532', 850: '#332e2b',
          875: '#2c2825', 900: '#262220', 950: '#211e1c', 975: '#1b1917',
        },
        avatar: {
          c1: '#3f6dd6', c2: '#8a5cd4', c3: '#127f60',
          c4: '#b4531f', c5: '#9a2f52', c6: '#2f6f86',
        },
      },

      fontFamily: {
        ui:   ['Segoe UI Variable Text', 'Segoe UI', 'Inter', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'monospace'],
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
        'sidebar-larga': '256px', 'sidebar-recolhida': '56px',
        'alvo-minimo': '24px', 'altura-controle': '32px',
      },

      borderRadius: { sm: '4px', md: '6px', lg: '8px', xl: '12px', total: '999px' },
      borderWidth:  { DEFAULT: '1px', fina: '1px' },

      boxShadow: {
        'elevacao-1': 'var(--elevacao-1)',
        'elevacao-3': 'var(--elevacao-3)',
        foco:    '0 0 0 1px var(--acento)',
        erro:    '0 0 0 1px var(--perigo)',
        interno: 'inset 0 0 0 1px currentColor',
      },

      transitionDuration:       { DEFAULT: '180ms', padrao: '180ms' },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(.33,0,.67,1)', padrao: 'cubic-bezier(.33,0,.67,1)' },

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
