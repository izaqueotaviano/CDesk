import { IconDeviceDesktop, IconLogout, IconMoon, IconSun, type Icon } from '@tabler/icons-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useMe } from '@/api/queries/useMe'
import { useLogout } from '@/api/mutations/useLogout'
import type { Me } from '@/api/types'
import { useAvisos } from '@/realtime/useAvisos'
import { useCanalPessoal } from '@/realtime/useCanalPessoal'
import { usePrefs, type Tema } from '@/stores/prefs'
import { Avatar } from '@/ui/Avatar'
import { urlDoAvatar } from '../api/conta'
import { cn } from '../lib/cn'
import { Button } from '../ui/button'
import { Toaster } from '../ui/toaster'
import { ITENS_NAV } from './nav'

const PROXIMO_TEMA: Record<Tema, Tema> = { claro: 'escuro', escuro: 'sistema', sistema: 'claro' }
const ROTULO_TEMA: Record<Tema, string> = { claro: 'tema claro', escuro: 'tema escuro', sistema: 'tema do sistema' }
const ICONE_TEMA: Record<Tema, Icon> = { claro: IconSun, escuro: IconMoon, sistema: IconDeviceDesktop }

/**
 * Item da sidebar e da zona utilitária — a MESMA anatomia do
 * `.sidebar-rail__item` do console: 36px, ícone de 18px numa caixa de 20,
 * rótulo de 13px em peso 500, hover na linha estrutural; ativo ganha o tint
 * de ação, a barrinha de 3px encostada na borda esquerda do rail e o ícone
 * na cor de ação.
 */
const ITEM =
  'relative flex w-full min-h-[36px] items-center gap-3 rounded-md px-2.5 text-left text-[13px] font-medio text-tinta-cromo transition-colors hover:bg-hover hover:text-tinta [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-tinta-secundaria hover:[&_svg]:text-tinta'
const ITEM_ATIVO =
  'bg-acento-suave font-forte text-tinta [&_svg]:text-acento before:absolute before:-left-3 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-[3px] before:bg-acento'

/**
 * Alterna claro → escuro → sistema. A escolha persiste (stores/prefs). O
 * rótulo anuncia a AÇÃO ("Usar tema escuro"), como o BotaoTema do console —
 * quem usa leitor de tela ouve o que o clique faz, não o que já está ligado.
 */
export function AlternarTema({ variante = 'icone', className }: { variante?: 'icone' | 'linha'; className?: string }) {
  const tema = usePrefs((s) => s.tema)
  const setTema = usePrefs((s) => s.setTema)
  const proximo = PROXIMO_TEMA[tema]
  const acao = `Usar ${ROTULO_TEMA[proximo]}`
  const Icone = ICONE_TEMA[proximo]
  if (variante === 'linha') {
    return (
      <button type="button" className={cn(ITEM, className)} onClick={() => setTema(proximo)} aria-label={acao} title={acao}>
        <span className="grid size-5 place-items-center">
          <Icone stroke={1.75} aria-hidden="true" />
        </span>
        <span className="truncate" aria-hidden="true">
          {acao}
        </span>
      </button>
    )
  }
  return (
    <Button variant="ghost" size="icon-sm" className={className} onClick={() => setTema(proximo)} aria-label={acao} title={acao}>
      <Icone stroke={1.75} />
    </Button>
  )
}

/** Marca + atalho para o Início — a mesma caixa de 32px do logo do console. */
function Marca({ me, compacta }: { me: Me | undefined; compacta?: boolean }) {
  return (
    <Link
      to="/portal"
      className="flex min-h-9 min-w-0 items-center gap-2.5 rounded-md px-1 text-tinta hover:bg-hover"
      aria-label="Central de Suporte — ir para o Início"
      title="Central de Suporte — ir para o Início"
    >
      <span className="grid size-8 shrink-0 place-items-center">
        <svg className="h-auto w-5" viewBox="0 0 236 270" fill="none" aria-hidden="true">
          <path
            d="M128.101 0C151.417 0 170.802 4.03 186.255 12.09C201.98 19.88 213.909 29.82 222.042 41.91C230.447 54 235.056 67.16 235.869 81.4C236.683 95.64 233.7 109.08 226.923 121.7C220.145 134.33 209.707 145.21 195.609 154.34C181.511 163.48 163.617 168.99 141.928 170.87C139.217 170.87 136.506 172.21 133.795 174.9C131.355 177.31 130.135 180.13 130.135 183.36C130.135 186.58 132.033 189.54 135.828 192.22C139.624 194.64 146.808 195.85 157.382 195.85H223.262V269.6H162.668C146.402 269.6 132.71 267.72 121.595 263.96C110.75 260.19 102.074 255.36 95.568 249.45C89.061 243.54 84.588 236.96 82.148 229.7C79.979 222.18 79.572 214.79 80.928 207.54C82.554 200.02 85.808 193.16 90.688 186.99C95.839 180.54 102.346 175.3 110.208 171.27H65.881V269.6L0 270V0H128.101ZM116.308 116.46C132.575 116.46 144.775 113.24 152.908 106.79C161.042 100.34 165.108 93.36 165.108 85.84C165.108 78.04 161.042 70.93 152.908 64.48C144.775 58.03 132.575 54.81 116.308 54.81H65.881V116.46H116.308Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-bold leading-tight tracking-[-0.01em]">Central de Suporte</span>
        {me?.company_name && !compacta && (
          <span className="block truncate text-legenda leading-tight text-tinta-secundaria">{me.company_name}</span>
        )}
      </span>
    </Link>
  )
}

function Sidebar({ me }: { me: Me | undefined }) {
  const logout = useLogout()
  return (
    <aside className="hidden w-[240px] shrink-0 flex-col bg-navegacao text-tinta-cromo md:flex" aria-label="Menu do portal">
      <div className="flex h-[52px] shrink-0 items-center  pl-3 pr-2">
        <Marca me={me} />
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {ITENS_NAV.map((item) => (
          <NavLink
            key={item.id}
            to={item.rota}
            end={item.exato}
            className={({ isActive }) => cn(ITEM, isActive && ITEM_ATIVO)}
          >
            <span className="grid size-5 shrink-0 place-items-center">
              <item.icone stroke={1.75} aria-hidden="true" />
            </span>
            <span className="truncate">{item.rotulo}</span>
          </NavLink>
        ))}
      </nav>

      <div className="flex shrink-0 flex-col gap-0.5  px-3 pb-2.5 pt-2">
        <AlternarTema variante="linha" />
        {me && (
          <Link
            to="/portal/configuracoes"
            className="flex min-h-10 items-center gap-2.5 rounded-md px-1.5 text-tinta hover:bg-hover"
            title="Minha conta"
          >
            <Avatar nome={me.full_name} urlFoto={urlDoAvatar(me.avatar_url)} tamanho="sm" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medio leading-tight">{me.full_name}</span>
              <span className="block truncate text-legenda leading-tight text-tinta-secundaria">{me.email}</span>
            </span>
          </Link>
        )}
        <button
          type="button"
          className={ITEM}
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-label="Sair"
          title="Sair"
        >
          <span className="grid size-5 place-items-center">
            <IconLogout stroke={1.75} aria-hidden="true" />
          </span>
          <span>{logout.isPending ? 'Saindo…' : 'Sair'}</span>
        </button>
      </div>
    </aside>
  )
}

function TopoCelular({ me }: { me: Me | undefined }) {
  return (
    <header className="sticky top-0 z-20 flex h-[52px] items-center justify-between  bg-navegacao px-3 md:hidden">
      <Marca me={me} compacta />
      <div className="flex items-center gap-1">
        <AlternarTema />
        {me && (
          <Link to="/portal/configuracoes" aria-label="Minha conta" className="rounded-total">
            <Avatar nome={me.full_name} urlFoto={urlDoAvatar(me.avatar_url)} tamanho="sm" />
          </Link>
        )}
      </div>
    </header>
  )
}

function BarraInferior() {
  const itens = ITENS_NAV.filter((i) => i.noCelular)
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30  bg-navegacao pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Navegação principal"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${itens.length}, minmax(0, 1fr))` }}>
        {itens.map((item) => (
          <li key={item.id}>
            <NavLink
              to={item.rota}
              end={item.exato}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-micro font-medio text-tinta-cromo',
                  isActive && 'text-acento',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('grid h-7 w-12 place-items-center rounded-md', isActive && 'bg-acento-suave')}>
                    <item.icone className="size-5" stroke={1.75} aria-hidden="true" />
                  </span>
                  {item.curto ?? item.rotulo}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * Shell do Painel do Cliente, no mesmo desenho do shell do console
 * (resolv/shell): o fundo inteiro é o CROMO — sidebar de 240px e a moldura
 * em volta — e o conteúdo vive num painel arredondado, no canvas, apoiado
 * sobre ele com um respiro de 12px. No celular a sidebar vira barra inferior
 * e o painel ocupa a tela inteira, sem moldura (a 390px o respiro e o canto
 * só roubariam espaço). As páginas cuidam do próprio título; o shell só dá
 * moldura, largura de leitura e navegação.
 */
export function PortalShell() {
  const { data: me } = useMe()
  // canal pessoal (ws/me/) — ticket_event, chat, presença
  useCanalPessoal()
  // resposta do atendimento avisa (som, título, notificação do sistema) só
  // quando o cliente está em outra aba
  useAvisos()

  return (
    <div className="flex h-full bg-navegacao font-ui text-tinta">
      <Sidebar me={me} />
      <div className="flex min-w-0 flex-1 flex-col md:p-respiro-painel md:pl-0">
        <TopoCelular me={me} />
        <main className="min-h-0 flex-1 overflow-y-auto bg-canvas pb-24 md:rounded-painel md:pb-0">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-8 md:py-8">
            <Outlet />
          </div>
        </main>
        <BarraInferior />
      </div>
      <Toaster />
    </div>
  )
}
