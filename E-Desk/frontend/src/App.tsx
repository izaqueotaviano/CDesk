import { Outlet } from 'react-router-dom'
import { PwaManifest } from '@/features/pwa/PwaManifest'

/** Raiz de toda a árvore de rotas — só o que precisa estar de pé em
 *  QUALQUER tela, pública ou não (o manifesto PWA certo, docs/10-pwa.md). */
export function App() {
  return (
    <>
      <PwaManifest />
      <Outlet />
    </>
  )
}
