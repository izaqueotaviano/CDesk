import { Navigate, useLocation } from 'react-router-dom'

/**
 * Os endereços do console eram `/chamados`, `/chamados/novo` e
 * `/chamados/:id`; viraram `/tickets/...` quando o produto passou a chamar
 * tudo de "ticket". E-mails, notificações já gravadas, favoritos e o
 * `?de=` do login ainda carregam o caminho antigo, então ele continua
 * funcionando: troca só o prefixo e mantém o resto — o id (sem
 * decodificar/recodificar), a query (`?empresa=7`) e o hash
 * (`#mensagem-43`, que a conversa usa para rolar até a mensagem).
 * `replace` para o endereço antigo não ficar no histórico (o "voltar" não
 * pode cair de novo no redirecionamento).
 */
export function RedirecionarDeChamados() {
  const { pathname, search, hash } = useLocation()
  const destino = pathname.replace(/^\/chamados(?=\/|$)/, '/tickets')
  return <Navigate to={{ pathname: destino, search, hash }} replace />
}
