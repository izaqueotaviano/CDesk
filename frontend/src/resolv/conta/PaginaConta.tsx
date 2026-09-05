import { useMe } from '@/api/queries/useMe'
import { urlDoAvatar } from '@/portal/api/conta'
import { SecaoSeguranca } from '@/portal/configuracoes/SecaoSeguranca'
import { Toaster } from '@/portal/ui/toaster'
import { Avatar } from '@/ui/Avatar'

/**
 * "Minha conta" da equipe de suporte: por enquanto, a verificação em duas
 * etapas — a mesma seção do portal do cliente, porque a regra é a mesma
 * (opcional por conta, e-mail ou aplicativo). Quem chega aqui é pelo nome
 * no topo do app.
 */
export function PaginaConta() {
  const { data: me } = useMe()
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex items-center gap-4">
        {me && <Avatar nome={me.full_name} urlFoto={urlDoAvatar(me.avatar_url)} tamanho="lg" />}
        <div className="min-w-0">
          <h1 className="text-titulo-lg font-forte tracking-display">Minha conta</h1>
          <p className="mt-0.5 truncate text-pequeno text-tinta-secundaria">
            {me ? `${me.full_name} · ${me.email}` : 'Carregando…'}
          </p>
        </div>
      </header>
      <SecaoSeguranca />
      <Toaster />
    </div>
  )
}
