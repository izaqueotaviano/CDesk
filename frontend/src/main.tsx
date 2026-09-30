// A tipografia do design system Convertize v2: Inter na interface inteira
// (inclusive nos números), Tenor Sans só em título editorial e JetBrains Mono
// só em dado técnico. Geist saiu: era leitura da v1, e o v2 pede Inter.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/tenor-sans/400.css'

// Ícones Tabler (classes `ti ti-*`) — subset dos 98 que o produto usa, gerado
// por scripts/gerar_subset_icones.py. Vinha de CDN, que a CSP de produção não
// libera (`font-src 'self' data:`): em produção o ícone não aparecia.
import './assets/icones/tabler-subset.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { aoDeslogar } from '@/api/client'
import { desconectarCanalPessoal } from '@/realtime/bridge'
import { useChatUi } from '@/stores/chatUi'
import { useTabs } from '@/stores/tabs'
import { router } from './routes'
import './styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// Interceptor global de 401 (docs/07-arquitetura-frontend.md: "401 → limpa o
// cache do Query e manda para /login"). Fica aqui, fora de qualquer
// componente, porque client.ts (quem dispara isto) não pode depender de React.
// `replace: true` evita empilhar N entradas de histórico quando várias
// chamadas em voo recebem 401 quase ao mesmo tempo (a mesma troca de rota
// se repete sem crescer a pilha); a área (portal/equipe) vem do caminho
// atual, já que este módulo não sabe em qual `RotaProtegida` a pessoa está.
aoDeslogar(() => {
  // mesmo motivo do logout explícito (`useLogout`): sem isto o canal
  // pessoal sobrevive à sessão que acabou de cair, e a próxima pessoa a
  // logar nesta aba herda um socket morto em vez de um novo.
  desconectarCanalPessoal()
  useChatUi.getState().limparTudo()
  // abas e rascunhos ficam no localStorage, que é da máquina e não da pessoa
  useTabs.getState().limparTudo()
  queryClient.clear()
  const paraLogin = window.location.pathname.startsWith('/portal') ? '/login/cliente' : '/login'
  router.navigate(paraLogin, { replace: true })
})

// Em DESENVOLVIMENTO o service worker fica desligado de propósito
// (vite.config.ts, `devOptions.enabled: false`) — quem o registra é o plugin,
// e só no build de produção. Então um service worker registrado nesta origem
// durante o dev só pode ter sobrado de um `npm run build` + preview antigo.
//
// E ele não fica quieto: serve o `index.html` daquele build, que aponta para
// arquivos que o `git pull` já renomeou (TELA BRANCA), e intercepta as
// chamadas de /api/ mesmo para outra origem, porque o escopo do service
// worker é a PÁGINA, não o destino (BOTÃO GIRANDO PARA SEMPRE). Os dois
// sintomas parecem bug do sistema e não são — e ninguém adivinha que a causa
// é um build de semanas atrás, porque `Cmd+Shift+R` não desregistra nada:
// o hard reload pula o cache HTTP, não o service worker.
//
// Aqui não há o que preservar: em dev o número certo de service workers é
// zero. Remove, limpa os caches e recarrega uma vez — na volta a lista já
// está vazia e nada mais acontece.
if (import.meta.env.DEV && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then(async (registros) => {
      if (registros.length === 0) return
      console.warn(
        `[resolv] ${registros.length} service worker(s) de um build antigo nesta origem. ` +
          'Removendo e recarregando — em desenvolvimento não deve existir nenhum.',
      )
      await Promise.all(registros.map((r) => r.unregister()))
      if ('caches' in window) {
        const chaves = await caches.keys()
        await Promise.all(chaves.map((c) => caches.delete(c)))
      }
      window.location.reload()
    })
    .catch(() => {
      // navegador sem permissão para listar (janela anônima, política do
      // site): não há o que limpar e não é motivo para derrubar o app.
    })
}

const raiz = document.getElementById('root')
if (!raiz) throw new Error('#root não encontrado em index.html')

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
