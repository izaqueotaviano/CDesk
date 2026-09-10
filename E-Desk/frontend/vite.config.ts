/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Backend e frontend vivem em ORIGENS DIFERENTES por decisão do projeto
// (docs/10-frontend-novo.md, docs/10-pwa.md): sessão em cookie + CORS com
// credenciais, não um proxy same-origin do Vite. Por isso não há `server.proxy`
// aqui — cada chamada em src/api/client.ts usa `credentials: 'include'` e a
// origem vem de VITE_API_BASE_URL (padrão http://localhost:8000, a porta fixa
// do backend em ./edesk).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest, não generateSW: o service worker é escrito à mão em
      // src/sw.ts (docs/10-pwa.md) porque a política de cache tem uma regra
      // que nenhum gerador conhece sozinho — nada que dependa de sessão
      // (/api/**, /ws**, /accounts/**, /admin/**) pode ser cacheado.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        // schema.d.ts é gerado (openapi-typescript) e pode ficar grande;
        // não faz sentido pré-cachear como "asset" do app.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      // Os dois manifests reais (equipe/cliente) são arquivos estáticos em
      // public/, escolhidos em runtime por rota (src/features/pwa/PwaManifest.tsx)
      // — o plugin não deve gerar nem injetar um terceiro.
      manifest: false,
      devOptions: {
        enabled: false, // service worker só faz sentido testar contra um build
      },
    }),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
