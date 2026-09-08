import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
// Serif de destaque — só a saudação da Início usa (--f-display); um peso
// já basta, o corpo da interface inteira continua em Inter.
import '@fontsource/libre-baskerville/400.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { aoDeslogar } from '@/api/client'
import { desconectarCanalPessoal } from '@/realtime/bridge'
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
  queryClient.clear()
  const paraLogin = window.location.pathname.startsWith('/portal') ? '/login/cliente' : '/login'
  router.navigate(paraLogin, { replace: true })
})

const raiz = document.getElementById('root')
if (!raiz) throw new Error('#root não encontrado em index.html')

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
