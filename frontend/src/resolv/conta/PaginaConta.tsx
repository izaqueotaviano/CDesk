import { useLogout } from '@/api/mutations/useLogout'
import { useMe } from '@/api/queries/useMe'
import { urlDoAvatar } from '@/portal/api/conta'
import { SecaoAcessos } from '@/portal/configuracoes/SecaoAcessos'
import { SecaoMeusDados } from '@/portal/configuracoes/SecaoMeusDados'
import { SecaoSeguranca } from '@/portal/configuracoes/SecaoSeguranca'
import { Button } from '@/portal/ui/button'
import { Toaster } from '@/portal/ui/toaster'
import { Avatar } from '@/ui/Avatar'
import { SecaoAssinatura } from './SecaoAssinatura'

/**
 * "Minha conta" da equipe de suporte: a assinatura das respostas e a
 * verificação em duas etapas — as duas últimas com as mesmas seções do
 * portal do cliente, porque a regra é a mesma. Quem chega aqui é pelo nome
 * no topo do app.
 */
export function PaginaConta() {
  const { data: me } = useMe()
  const logout = useLogout()
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex items-center gap-4">
        {me && <Avatar nome={me.full_name} urlFoto={urlDoAvatar(me.avatar_url)} tamanho="lg" />}
        <div className="min-w-0 flex-1">
          <h1 className="text-titulo-lg font-forte tracking-display">Minha conta</h1>
          <p className="mt-0.5 truncate text-pequeno text-tinta-secundaria">
            {me ? `${me.full_name} · ${me.email}` : 'Carregando…'}
          </p>
        </div>
        <Button variant="secondary" disabled={logout.isPending} onClick={() => logout.mutate()}>
          {logout.isPending ? 'Saindo…' : 'Sair'}
        </Button>
      </header>
      <SecaoAssinatura />
      <SecaoSeguranca />
      <SecaoAcessos />
      <SecaoMeusDados />
      <Toaster />
    </div>
  )
}
