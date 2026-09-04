import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const CAMINHO_MANIFEST_CLIENTE = '/manifest-cliente.webmanifest'
const CAMINHO_MANIFEST_EQUIPE = '/manifest-equipe.webmanifest'

/**
 * Dois manifests, escolhidos em runtime pela rota — não pelo plugin
 * (docs/10-pwa.md: `manifest: false` em vite.config.ts). `/portal` e
 * `/login/cliente` são cliente; o resto é equipe. Fica na raiz da aplicação
 * (App), não dentro de AppShell/PortalShell — o manifesto tem que estar
 * certo mesmo nas rotas públicas de login.
 *
 * Nota: manifesto por empresa foi avaliado e descartado (docs/10-pwa.md) —
 * não reintroduza isso sem reler o motivo (credenciais no fetch do
 * manifesto, nome congelado na instalação, exposição do nome do cliente).
 */
export function PwaManifest() {
  const location = useLocation()
  const ehCliente = location.pathname.startsWith('/portal') || location.pathname.startsWith('/login/cliente')

  useEffect(() => {
    const caminho = ehCliente ? CAMINHO_MANIFEST_CLIENTE : CAMINHO_MANIFEST_EQUIPE
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'manifest'
      document.head.appendChild(link)
    }
    link.href = caminho
  }, [ehCliente])

  return null
}
