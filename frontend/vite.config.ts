/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Em desenvolvimento o Vite faz PROXY do backend, e a tela fala só com a
// porta 5174. Antes eram duas origens (5174 e 8000) com CORS e credenciais,
// e isso custou caro: o navegador precisa de um OPTIONS de permissão antes
// de cada POST, e qualquer coisa que atrapalhe esse caminho — proxy do
// sistema, VPN, extensão, service worker antigo — prende a chamada sem dar
// erro. O `curl` não reproduz nada disso, porque não manda preflight; então
// o backend parecia sadio enquanto a tela não entrava.
//
// O proxy também aproxima o dev da PRODUÇÃO, que sempre foi same-origin:
// deploy/nginx/resolv.conf serve /api/ e /ws/ no mesmo host da SPA. Ou seja,
// as duas origens eram uma particularidade só do dev — e a fonte de uma
// classe inteira de problema que não existe em produção.
//
// Continua dando para apontar para outro backend: `VITE_API_BASE_URL` e
// `VITE_WS_BASE_URL` ganham do proxy quando definidas (é assim que
// `./resolv compartilhar` publica a API na rede local).
// Para onde o proxy manda. Variável de ambiente porque em modo docker o
// backend pode estar em outro lugar que não a porta local.
const ALVO_DO_PROXY = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000'

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
    // 127.0.0.1 e não `localhost`: em máquina com IPv6 ativo o `localhost`
    // resolve para ::1 antes de 127.0.0.1, e o backend escuta em IPv4.
    // Fixar aqui evita a primeira tentativa morrer no escuro.
    proxy: {
      // Os mesmos prefixos que o nginx de produção entrega ao Django
      // (deploy/nginx/resolv.conf). Nenhum deles é rota da SPA, então não
      // há como um clique na interface cair no proxy por engano.
      '/api': { target: ALVO_DO_PROXY, changeOrigin: false },
      '/accounts': { target: ALVO_DO_PROXY, changeOrigin: false },
      '/admin': { target: ALVO_DO_PROXY, changeOrigin: false },
      '/embed': { target: ALVO_DO_PROXY, changeOrigin: false },
      '/health': { target: ALVO_DO_PROXY, changeOrigin: false },
      '/static': { target: ALVO_DO_PROXY, changeOrigin: false },
      '/media': { target: ALVO_DO_PROXY, changeOrigin: false },
      // O canal em tempo real pede upgrade de protocolo, não HTTP comum:
      // sem `ws: true` o Vite responde 426 e o socket nunca sobe.
      '/ws': { target: ALVO_DO_PROXY, ws: true, changeOrigin: false },
    },
    // `host: true` escuta em todas as interfaces (0.0.0.0), não só
    // localhost — sem isto `./resolv compartilhar` expunha a API pra rede
    // mas o Vite continuava só alcançável da própria máquina: quem testasse
    // de outro aparelho batia num "conexão recusada" na porta 5174 mesmo com
    // o .env do backend todo configurado.
    host: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
    host: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
