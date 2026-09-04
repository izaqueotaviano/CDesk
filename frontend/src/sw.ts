/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute, setDefaultHandler } from 'workbox-routing'
import { NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

/**
 * Service worker ESCRITO À MÃO (estratégia injectManifest, não generateSW) —
 * docs/10-pwa.md. O plugin só injeta `self.__WB_MANIFEST` (nomes com hash do
 * build do Vite); toda a política de cache abaixo é decisão nossa.
 *
 * A REGRA que governa tudo: nada que dependa de quem está logado entra em
 * cache. Isto é testado — `pwa.test.ts` varre o Cache Storage inteiro depois
 * de bater em /auth/me/, /tickets/ e /notifications/ e exige zero URL de
 * /api/ e zero ocorrência do conteúdo de ticket dentro de corpos cacheados.
 */

precacheAndRoute(self.__WB_MANIFEST)

// Fontes e ícones não dependem de sessão — podem ficar velhos por um tempo.
registerRoute(
  ({ url }) => url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icones/'),
  new StaleWhileRevalidate(),
)

// Dado de sessão: NUNCA cacheado, sob nenhuma estratégia.
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly())
registerRoute(({ url }) => url.pathname.startsWith('/ws'), new NetworkOnly())
// OAuth — cachear o redirecionamento quebra o login.
registerRoute(({ url }) => url.pathname.startsWith('/accounts/'), new NetworkOnly())
registerRoute(({ url }) => url.pathname.startsWith('/admin/'), new NetworkOnly())

// Handler padrão: qualquer coisa que não bateu numa rota acima também é
// NetworkOnly — nenhum "esqueci de listar" vira cache por omissão.
setDefaultHandler(new NetworkOnly())

// Atualização sem reload automático: a versão nova fica em `waiting` até a
// pessoa confirmar (UpdateToast, em src/features/pwa/) — recarregar sozinho
// custaria o rascunho de resposta que o agente está digitando numa aba
// (docs/06-abas-frontend.md).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string })?.type === 'SKIP_WAITING') self.skipWaiting()
})
