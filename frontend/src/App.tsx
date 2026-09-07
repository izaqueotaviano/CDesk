import { Outlet } from 'react-router-dom'
import { PwaManifest } from '@/features/pwa/PwaManifest'
// Reset + tokens (`--cvz-*`) do design system cvzdesk. Não é só das rotas
// que ainda montam CvzAppLayout: componentes de `cvz/components` já são
// usados dentro do shell Resolv (Topbar, detalhe de ticket, admin de
// agentes) — sem este import na raiz, bastava ninguém mais importar
// CvzAppLayout (Fase 1 da unificação de shell tirou as 5 rotas que faziam
// isso) para o Vite descartar o módulo como código morto e apagar essas
// variáveis, quebrando cor em telas que nunca tiveram nada a ver com o
// layout antigo.
import '@/cvz/styles/global.scss'

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
