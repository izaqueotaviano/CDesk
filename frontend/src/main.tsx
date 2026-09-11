import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@material/web/all.js'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { aoDeslogar } from '@/api/client'
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
aoDeslogar(() => {
  queryClient.clear()
  router.navigate('/login')
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
