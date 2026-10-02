import {
  IconBell,
  IconClockPause,
  IconDeviceDesktop,
  IconFileText,
  IconPalette,
  IconShieldCheck,
  IconSignature,
  type Icon,
} from '@tabler/icons-react'
import { useLogout } from '@/api/mutations/useLogout'
import { useMe } from '@/api/queries/useMe'
import { urlDoAvatar } from '@/portal/api/conta'
import { SecaoAcessos } from '@/portal/configuracoes/SecaoAcessos'
import { SecaoMeusDados } from '@/portal/configuracoes/SecaoMeusDados'
import { SecaoSeguranca } from '@/portal/configuracoes/SecaoSeguranca'
import { Button } from '@/portal/ui/button'
import { Toaster } from '@/portal/ui/toaster'
import { Avatar } from '@/ui/Avatar'
import { SecaoAparencia } from './SecaoAparencia'
import { SecaoAssinatura } from './SecaoAssinatura'
import { SecaoAusencia } from './SecaoAusencia'
import { SecaoNotificacoes } from './SecaoNotificacoes'

interface ItemDoMenu {
  id: string
  rotulo: string
  icone: Icon
  /** Só para quem é da equipe (a presença não existe para cliente). */
  soInterno?: boolean
}

const SECOES: ItemDoMenu[] = [
  { id: 'aparencia', rotulo: 'Aparência', icone: IconPalette },
  { id: 'notificacoes', rotulo: 'Notificações', icone: IconBell },
  { id: 'ausencia', rotulo: 'Ausência automática', icone: IconClockPause, soInterno: true },
  { id: 'assinatura', rotulo: 'Assinatura', icone: IconSignature },
  { id: 'seguranca', rotulo: 'Verificação em duas etapas', icone: IconShieldCheck },
  { id: 'acessos', rotulo: 'Sessões e acesso', icone: IconDeviceDesktop },
  { id: 'meus-dados', rotulo: 'Meus dados', icone: IconFileText },
]

/**
 * "Minha conta" da equipe de suporte. Mesma anatomia das Configurações do
 * portal (portal/configuracoes/PaginaConfiguracoes): menu de âncoras à
 * esquerda no desktop, em fita no celular, e um cartão branco por assunto
 * sobre o plano. Cada cartão salva sozinho.
 *
 * A ordem é a de quem usa o produto o dia inteiro: primeiro o que muda o
 * dia a dia (aparência, notificações, ausência automática), depois a
 * assinatura das respostas, e por fim segurança e dados, que se visitam
 * raramente. As três últimas são as mesmas seções do portal, porque a regra
 * é a mesma.
 */
export function PaginaConta() {
  const { data: me } = useMe()
  const logout = useLogout()
  // `!== false`: enquanto o `me` carrega, a página se comporta como da
  // equipe (é quem chega em /conta); só um cliente confirmado perde a seção
  const interno = me?.is_internal !== false
  const secoes = SECOES.filter((s) => interno || !s.soInterno)

  return (
    <div className="conta-pagina mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
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

      {/* Celular: as âncoras viram uma fita que rola de lado. */}
      <nav aria-label="Seções de Minha conta" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:hidden">
        {secoes.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-total bg-superficie px-3 text-pequeno font-medio text-tinta-secundaria hover:text-tinta"
          >
            <s.icone className="size-3.5" stroke={1.75} aria-hidden="true" />
            {s.rotulo}
          </a>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Seções de Minha conta" className="hidden lg:block">
          <ul className="sticky top-6 flex flex-col gap-0.5">
            {secoes.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  // min-h, não h: com o texto no "Maior" um rótulo longo
                  // quebra em duas linhas e precisa crescer, não vazar
                  className="flex min-h-8 items-center gap-2.5 rounded-sm px-2 py-1 text-corpo leading-tight text-tinta-secundaria hover:bg-navegacao-hover hover:text-tinta"
                >
                  <s.icone className="size-[18px] shrink-0" stroke={1.75} aria-hidden="true" />
                  {s.rotulo}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <SecaoAparencia />
          <SecaoNotificacoes />
          {interno && <SecaoAusencia />}
          <SecaoAssinatura />
          <SecaoSeguranca />
          <SecaoAcessos />
          <SecaoMeusDados />
        </div>
      </div>
      <Toaster />
    </div>
  )
}
