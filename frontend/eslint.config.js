import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Flat config — padrão do ESLint desde a v9; .eslintrc.cjs não é mais lido
// por padrão. `src/sw.ts` também é excluído aqui pelo mesmo motivo do
// tsconfig.json: mistura globals de DOM e de ServiceWorker.
export default tseslint.config(
  { ignores: ['dist', 'src/api/schema.d.ts', 'src/sw.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Campos de resposta da API que o front só deve renderizar, nunca
      // reinterpretar (content_hidden, requester_display, is_restricted…) —
      // `any` implícito ali é exatamente onde esse tipo de bug entra.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
