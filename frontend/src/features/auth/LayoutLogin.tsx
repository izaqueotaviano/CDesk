import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { IconShieldCheck, type Icon } from '@tabler/icons-react'
import { MARCA_PADRAO, urlDaImagemDeMarca, type PublicoLogin } from '@/api/branding'
import { cn } from '@/portal/lib/cn'
import { AlternarTema } from '@/portal/shell/PortalShell'
import { PUBLICOS, useMarcaDoPublico, type Marca } from './publicos'
import './login.css'

/**
 * A moldura das telas sem sessão: entrar, pedir o link de senha e criar a
 * senha nova. Formulário à esquerda, painel da marca à direita no desktop
 * (sempre escuro, nos dois temas: `--login-painel`), troca de público e tema
 * no canto. Um componente só para as quatro telas: a pessoa que clicou em
 * "Esqueci minha senha" não pode sentir que saiu do produto.
 */

/** Marca: o "R" do console/portal (mesmo traçado de `Sidebar.tsx` e
 *  `PortalShell.tsx`) + o nome que o admin configurou. O quadrado laranja é
 *  o único laranja da tela, e é o logotipo. */
function Logotipo({ nome, className }: { nome: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-laranja text-white">
        <svg className="h-auto w-4" viewBox="0 0 236 270" fill="none" aria-hidden="true">
          <path
            d="M128.101 0C151.417 0 170.802 4.03 186.255 12.09C201.98 19.88 213.909 29.82 222.042 41.91C230.447 54 235.056 67.16 235.869 81.4C236.683 95.64 233.7 109.08 226.923 121.7C220.145 134.33 209.707 145.21 195.609 154.34C181.511 163.48 163.617 168.99 141.928 170.87C139.217 170.87 136.506 172.21 133.795 174.9C131.355 177.31 130.135 180.13 130.135 183.36C130.135 186.58 132.033 189.54 135.828 192.22C139.624 194.64 146.808 195.85 157.382 195.85H223.262V269.6H162.668C146.402 269.6 132.71 267.72 121.595 263.96C110.75 260.19 102.074 255.36 95.568 249.45C89.061 243.54 84.588 236.96 82.148 229.7C79.979 222.18 79.572 214.79 80.928 207.54C82.554 200.02 85.808 193.16 90.688 186.99C95.839 180.54 102.346 175.3 110.208 171.27H65.881V269.6L0 270V0H128.101ZM116.308 116.46C132.575 116.46 144.775 113.24 152.908 106.79C161.042 100.34 165.108 93.36 165.108 85.84C165.108 78.04 161.042 70.93 152.908 64.48C144.775 58.03 132.575 54.81 116.308 54.81H65.881V116.46H116.308Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="truncate text-titulo font-forte">{nome}</span>
    </div>
  )
}

/**
 * O painel da direita (desktop): o sólido escuro de `--login-painel` — ou a
 * foto que o admin enviou, com um véu escuro por cima para o texto continuar
 * legível. Texto centrado, sem cartão: num campo calmo o texto não precisa
 * de moldura.
 *
 * Não é `aria-hidden`: headline e destaques são texto de verdade, e o leitor
 * de tela lê depois do formulário (ordem do DOM), que é onde interessa.
 */
function PainelDaMarca({ marca, icones }: { marca: Marca | null; icones: Icon[] }) {
  const imagem = urlDaImagemDeMarca(marca?.image_url ?? null)
  const temTexto = Boolean(marca && (marca.headline || marca.highlights.length > 0))
  return (
    <aside className={cn('login-painel relative hidden overflow-hidden lg:block', imagem && 'login-painel--foto')}>
      {imagem && (
        <>
          <img src={imagem} alt="" className="absolute inset-0 size-full object-cover" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/10" />
        </>
      )}

      <div className="relative flex h-full flex-col justify-center gap-10 p-10 xl:p-16">
        {marca && temTexto && (
          <div className="max-w-[42ch]">
            {marca.headline && (
              <p className="text-titulo-lg font-normal leading-justa text-[#faf9f5]">{marca.headline}</p>
            )}
            {marca.highlights.length > 0 && (
              <ul className={cn('flex flex-col gap-4 text-corpo leading-solta text-[#c9c7c2]', marca.headline && 'mt-8')}>
                {marca.highlights.map((texto, i) => {
                  const Icone = icones[i] ?? icones[icones.length - 1]
                  return (
                    <li key={texto} className="flex items-start gap-3">
                      {/* Cor fixa, e não `text-acento`: o acento é o próprio
                          carvão, e sobre o painel escuro seria carvão em cima
                          de carvão — ícone invisível. */}
                      <Icone className="mt-1 size-4 shrink-0 text-[#a3a09a]" stroke={1.75} aria-hidden="true" />
                      {texto}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
        <p className={cn('login-painel__rodape text-pequeno', imagem ? 'text-white/75' : 'text-[#a3a09a]')}>
          Resolv · sistema de atendimento
        </p>
      </div>
    </aside>
  )
}

/**
 * No celular o painel inteiro não cabe: a foto do admin (se houver) vira uma
 * faixa curta no topo, e os destaques ficam de fora — numa tela de 390px o
 * que importa é o formulário acima da dobra. Sem foto, nem faixa.
 */
function FaixaCelular({ marca }: { marca: Marca | null }) {
  const imagem = urlDaImagemDeMarca(marca?.image_url ?? null)
  if (!imagem) return null
  return (
    <div
      className="-mx-4 -mt-4 mb-6 h-[124px] bg-cover bg-center sm:-mx-8 lg:hidden"
      style={{ backgroundImage: `linear-gradient(to top, rgba(0,0,0,.45), rgba(0,0,0,.1)), url("${imagem}")` }}
      aria-hidden="true"
    />
  )
}

interface Props {
  publico: PublicoLogin
  children: ReactNode
  /** Mostra o "É cliente? Acessar o portal" (ou o inverso) no canto. Só faz
   *  sentido na tela de entrar; nas de senha o público já está decidido. */
  comTrocaDePublico?: boolean
}

export function LayoutLogin({ publico, children, comTrocaDePublico = false }: Props) {
  const contexto = PUBLICOS[publico]
  const marca = useMarcaDoPublico(publico)
  const nomeDaMarca = marca?.brand_name ?? MARCA_PADRAO[publico].brand_name

  return (
    <div className="relative min-h-screen bg-canvas text-tinta lg:grid lg:h-screen lg:grid-cols-[1fr_minmax(340px,42%)] lg:overflow-hidden">
      {/* Troca de público + tema, num nó só: no desktop flutua sobre o painel
          escuro, no celular sobre o próprio formulário. Dois blocos por
          breakpoint dariam dois links de mesmo nome no DOM. */}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
        {comTrocaDePublico && (
          <>
            <span className="hidden text-pequeno text-tinta-secundaria sm:inline lg:text-[#c9c7c2]">
              {contexto.outroPublico.pergunta}
            </span>
            <Link
              to={contexto.outroPublico.rota}
              className="inline-flex h-8 items-center rounded-sm border border-divisoria bg-superficie px-3 text-pequeno font-medio text-tinta transition-colors hover:bg-navegacao"
            >
              {contexto.outroPublico.acao}
            </Link>
          </>
        )}
        <AlternarTema className="size-8 rounded-sm border border-divisoria bg-superficie hover:bg-navegacao" />
      </div>

      <main className="flex min-h-screen flex-col px-4 pb-8 pt-4 sm:px-8 lg:min-h-0 lg:overflow-y-auto lg:px-12 lg:py-6">
        <FaixaCelular marca={marca} />
        {/* Abaixo de `lg` a marca divide a linha com o bloco do canto: o teto
            de largura corta o nome com reticências em vez de sobrepor. */}
        <Logotipo nome={nomeDaMarca} className="max-w-[52%] lg:max-w-none" />

        <div className="flex flex-1 items-start py-10 lg:items-center lg:py-8">
          <div className="login-cartao relative mx-auto w-full max-w-[400px]">{children}</div>
        </div>

        <footer className="flex items-center justify-center gap-1.5 text-center text-pequeno text-tinta-secundaria">
          <IconShieldCheck className="size-4 shrink-0" stroke={1.75} aria-hidden="true" />
          Conexão segura · verificação em duas etapas disponível
        </footer>
      </main>

      <PainelDaMarca marca={marca} icones={contexto.icones} />
    </div>
  )
}
