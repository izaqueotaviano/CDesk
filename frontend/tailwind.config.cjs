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
        // A AÇÃO do produto (botão primário) — carvão no claro, claro no
        // escuro. Regra de marca do v2: laranja não preenche ação.
        primario: {
          DEFAULT: 'var(--primario)',
          hover:   'var(--primario-hover)',
          sobre:   'var(--primario-sobre)',
        },
        // `acento` é o laranja LEGÍVEL (link, item ativo, ícone de estado).
        // O laranja cheio é `laranja`, e só marca foco, seleção e marca.
        acento: {
          DEFAULT: 'var(--acento)',
          hover:   'var(--acento-hover)',
          suave:   'var(--acento-suave)',
          sobre:   'var(--acento-sobre)',
        },
        foco: { DEFAULT: 'var(--foco)', anel: 'var(--foco-anel)' },
        perigo: { DEFAULT: 'var(--perigo)', suave: 'var(--perigo-suave)' },
        alerta: { DEFAULT: 'var(--alerta)', suave: 'var(--alerta-suave)' },
        ok:     { DEFAULT: 'var(--ok)',     suave: 'var(--ok-suave)' },
        sobreposicao: 'var(--sobreposicao)',

        // Primitivos de MARCA do Convertize: fixos nos dois temas. `laranja`
        // é o laranja cheio (#ff5e2c) — preenchimento e grafismo só, nunca
        // texto — e `grafite` é a tinta do kit, o fundo do `.button` de tela
        // de marca. Quem segue o tema usa `acento`/`tinta`, não estes.
        laranja: 'var(--laranja)',
        grafite: 'var(--grafite)',

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

      // UMA família. As três chaves continuam porque ~50 arquivos usam
      // `font-mono`/`font-display`, mas apontam para a mesma pilha — a
      // troca de fonte num rótulo pequeno era o que dava cara de painel
      // técnico a uma tela que deveria parecer documento.
      //
      // Estas pilhas são LITERAIS: o Tailwind não lê `--f-ui`, então mudar
      // só o token não muda `font-ui` coisa nenhuma. Já mordeu uma vez.
      fontFamily: {
        ui:      ['Segoe UI', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono:    ['Segoe UI', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Segoe UI', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },

      // escala base 14px razão 1,125
      fontSize: {
        micro:       ['12px',  { lineHeight: '1' }],
        legenda:     ['12px',    { lineHeight: '1.43' }],
        pequeno:     ['12px',  { lineHeight: '1.43' }],
        corpo:       ['14px',    { lineHeight: '1.43' }],
        'corpo-lg':  ['16px', { lineHeight: '1.75' }],
        'titulo-sm': ['16px', { lineHeight: '1.2' }],
        titulo:      ['16px',    { lineHeight: '1.2' }],
        'titulo-lg': ['28px',  { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        display:     ['28px', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
      },
      fontWeight: { normal: '400', medio: '500', forte: '600' },
      lineHeight: { nenhuma: '1', justa: '1.2', normal: '1.43', solta: '1.75' },
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
