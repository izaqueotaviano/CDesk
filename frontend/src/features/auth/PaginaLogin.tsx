import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { ArrowLeft, Eye, EyeOff, Headset, LifeBuoy, MailCheck, ShieldCheck, Smartphone, Ticket, type LucideIcon } from 'lucide-react'
import { useConfirmar2fa, useReenviar2fa } from '@/api/mutations/use2fa'
import { precisaDeCodigo, useLogin } from '@/api/mutations/useLogin'
import { MARCA_PADRAO, urlDaImagemDeMarca, useMarcaLogin, type MarcaLogin, type PublicoLogin } from '@/api/branding'
import { ApiError } from '@/api/client'
import type { Me } from '@/api/types'
import { cn } from '@/portal/lib/cn'
import { AlternarTema } from '@/portal/shell/PortalShell'
import { Alert } from '@/portal/ui/alert'
import { Button } from '@/portal/ui/button'
import { ErroCampo, Input, Label } from '@/portal/ui/input'
import './login.css'

/** `?erro=` na volta do redirect do allauth (`apps/accounts/adapters.py`,
 *  `SocialAccountAdapter.pre_social_login`) — a única forma de o backend
 *  avisar algo aqui, já que esse fluxo é redirect de navegador, não fetch.
 *  A tela não tem mais botão de rede social (decisão de produto), mas a rota
 *  `/accounts/google/login/` continua existindo no backend; quem chegar por
 *  ela e for recusado ainda precisa ler o motivo. */
const ERRO_GOOGLE: Record<string, string> = {
  dominio: 'Esse e-mail do Google não tem acesso ao painel. Entre com e-mail e senha, ou fale com um administrador.',
  inativo: 'Sua conta está inativa. Fale com um administrador.',
}

const esquemaCredenciais = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe sua senha.'),
})
type Credenciais = z.infer<typeof esquemaCredenciais>

const REENVIO_SEGUNDOS = 30

/** O que é fixo por público: título, ícones dos destaques e o atalho para o
 *  outro público. Os textos e a imagem do painel vêm da marca configurada
 *  pelo admin (Configurações → Tela de login). */
interface Contexto {
  publico: PublicoLogin
  titulo: string
  subtitulo: string
  icones: LucideIcon[]
  placeholderEmail: string
  outroPublico: { pergunta: string; acao: string; rota: string }
}

const CONTEXTOS: Record<PublicoLogin, Contexto> = {
  cliente: {
    publico: 'cliente',
    titulo: 'Entrar no portal',
    subtitulo: 'Acompanhe seus chamados, fale com a equipe e avalie o atendimento.',
    icones: [Ticket, Headset, LifeBuoy],
    placeholderEmail: 'voce@suaempresa.com.br',
    outroPublico: { pergunta: 'É da equipe de suporte?', acao: 'Entrar no painel', rota: '/login' },
  },
  equipe: {
    publico: 'equipe',
    titulo: 'Entrar no painel',
    subtitulo: 'A fila, o chat e os indicadores da equipe.',
    icones: [Ticket, Headset, ShieldCheck],
    placeholderEmail: 'voce@empresa.com.br',
    outroPublico: { pergunta: 'É cliente?', acao: 'Acessar o portal', rota: '/login/cliente' },
  },
}

type Marca = Omit<MarcaLogin, 'audience' | 'updated_at'>

/** Mensagem que a pessoa consegue agir em cima — não o texto cru do DRF. */
function mensagemDeErro(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
  if (e.status === 429) {
    const segundos = Number(e.detail?.match(/(\d+) segundos?/)?.[1] ?? 0)
    const minutos = Math.max(1, Math.ceil(segundos / 60))
    return `Muitas tentativas. Aguarde ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} e tente de novo.`
  }
  if (e.status >= 500) return 'O servidor não respondeu como esperado. Tente de novo em instantes.'
  return e.detail ?? 'Não foi possível continuar.'
}

/** Para onde ir depois de entrar: de onde a pessoa veio, se fizer sentido
 *  para o tipo de conta; senão, a casa de cada um. */
function destinoDepoisDoLogin(me: Me, de: string | undefined): string {
  if (me.is_internal) return de && !de.startsWith('/portal') && !de.startsWith('/login') ? de : '/inicio'
  return de && de.startsWith('/portal') ? de : '/portal'
}

/** Marca: o "R" do console/portal (mesmo traçado de `Sidebar.tsx` e
 *  `PortalShell.tsx`) + o nome que o admin configurou. */
function Marca({ nome, className }: { nome: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-tinta text-canvas">
        <svg className="h-auto w-4" viewBox="0 0 236 270" fill="none" aria-hidden="true">
          <path
            d="M128.101 0C151.417 0 170.802 4.03 186.255 12.09C201.98 19.88 213.909 29.82 222.042 41.91C230.447 54 235.056 67.16 235.869 81.4C236.683 95.64 233.7 109.08 226.923 121.7C220.145 134.33 209.707 145.21 195.609 154.34C181.511 163.48 163.617 168.99 141.928 170.87C139.217 170.87 136.506 172.21 133.795 174.9C131.355 177.31 130.135 180.13 130.135 183.36C130.135 186.58 132.033 189.54 135.828 192.22C139.624 194.64 146.808 195.85 157.382 195.85H223.262V269.6H162.668C146.402 269.6 132.71 267.72 121.595 263.96C110.75 260.19 102.074 255.36 95.568 249.45C89.061 243.54 84.588 236.96 82.148 229.7C79.979 222.18 79.572 214.79 80.928 207.54C82.554 200.02 85.808 193.16 90.688 186.99C95.839 180.54 102.346 175.3 110.208 171.27H65.881V269.6L0 270V0H128.101ZM116.308 116.46C132.575 116.46 144.775 113.24 152.908 106.79C161.042 100.34 165.108 93.36 165.108 85.84C165.108 78.04 161.042 70.93 152.908 64.48C144.775 58.03 132.575 54.81 116.308 54.81H65.881V116.46H116.308Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="truncate text-titulo-sm font-forte tracking-titulo">{nome}</span>
    </div>
  )
}

/**
 * As linhas que "escorrem" pelo painel da marca — 24 curvas cúbicas
 * deslocadas uma da outra, espelhadas por `posicao` (1 ou -1). A geometria
 * é a da referência (21st.dev, auth-page), que animava em loop com
 * framer-motion. Aqui é CSS (login.css): cada curva se DESENHA uma vez ao
 * abrir (`stroke-dashoffset` com `pathLength="1"`, escalonado por índice) e
 * depois o conjunto inteiro só deriva por `transform`, que não repinta.
 * Nada de `Math.random()`: render determinístico (teste, StrictMode).
 */
function LinhasFlutuantes({ posicao }: { posicao: 1 | -1 }) {
  const linhas = Array.from({ length: 24 }, (_, k) => {
    const i = k * 1.5 // mantém o espalhamento das 36 originais
    return {
      id: k,
      d: `M-${380 - i * 5 * posicao} -${189 + i * 6}C-${380 - i * 5 * posicao} -${189 + i * 6} -${312 - i * 5 * posicao} ${216 - i * 6} ${152 - i * 5 * posicao} ${343 - i * 6}C${616 - i * 5 * posicao} ${470 - i * 6} ${684 - i * 5 * posicao} ${875 - i * 6} ${684 - i * 5 * posicao} ${875 - i * 6}`,
      largura: 0.5 + i * 0.03,
      opacidade: Math.min(1, 0.1 + i * 0.03),
      atraso: `${k * 60}ms`,
    }
  })
  return (
    <div className={cn('login-linhas text-tinta', posicao === -1 && 'login-linhas--espelho')} aria-hidden="true">
      <svg viewBox="0 0 696 316" fill="none" preserveAspectRatio="xMidYMid slice">
        {linhas.map((l) => (
          <path
            key={l.id}
            d={l.d}
            pathLength={1}
            stroke="currentColor"
            strokeWidth={l.largura}
            strokeOpacity={l.opacidade}
            style={{ '--atraso': l.atraso } as React.CSSProperties}
          />
        ))}
      </svg>
    </div>
  )
}

/**
 * O painel da marca (desktop): superfície sutil com as linhas animadas e um
 * degradê do canvas subindo por baixo dos textos — ou, se o admin enviou uma
 * imagem, a imagem com o degradê escuro (aí as linhas não entram: a foto já
 * é o fundo). Marca em cima, chamada e destaques embaixo, como uma citação.
 */
function PainelDaMarca({ marca, nome, icones }: { marca: Marca | null; nome: string; icones: LucideIcon[] }) {
  const imagem = urlDaImagemDeMarca(marca?.image_url ?? null)
  const temTexto = Boolean(marca && (marca.headline || marca.highlights.length > 0))
  return (
    <aside
      className={cn(
        'relative hidden flex-col overflow-hidden border-r border-divisoria p-10 lg:flex',
        imagem ? 'text-white' : 'bg-superficie-sutil text-tinta',
      )}
      style={imagem ? { backgroundImage: `url("${imagem}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      aria-hidden="true"
    >
      {imagem ? (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/20" />
      ) : (
        <>
          <LinhasFlutuantes posicao={1} />
          <LinhasFlutuantes posicao={-1} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/70 to-transparent" />
        </>
      )}
      <Marca nome={nome} className={cn('relative z-10', imagem && '[&>span:first-child]:bg-white/15 [&>span:first-child]:text-white [&>span:first-child]:backdrop-blur')} />
      <div className="relative z-10 mt-auto flex flex-col gap-6">
        {marca && temTexto && (
          <>
            {marca.headline && <p className="max-w-md text-display font-forte leading-justa tracking-display">{marca.headline}</p>}
            {marca.highlights.length > 0 && (
              <ul className={cn('flex max-w-md flex-col gap-3 text-corpo', imagem ? 'text-white/85' : 'text-tinta-secundaria')}>
                {marca.highlights.map((texto, i) => {
                  const Icone = icones[i] ?? icones[icones.length - 1]
                  return (
                    <li key={texto} className="flex items-start gap-3">
                      <Icone className="mt-0.5 size-4 shrink-0" />
                      {texto}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
        <p className={cn('font-mono text-legenda', imagem ? 'text-white/70' : 'text-tinta-terciaria')}>Resolv · sistema de atendimento</p>
      </div>
    </aside>
  )
}

/** Os brilhos radiais atrás do formulário (login.css) — só textura, sem
 *  função; `aria-hidden` e fora da árvore de leitura. */
function Brilhos() {
  return (
    <div className="login-brilhos" aria-hidden="true">
      <div className="login-brilho login-brilho--1" />
      <div className="login-brilho login-brilho--2" />
      <div className="login-brilho login-brilho--3" />
    </div>
  )
}

/**
 * No celular a imagem do admin (se houver) vira um banner compacto no topo;
 * sem imagem, a marca aparece em linha, logo acima do título — o painel
 * inteiro não cabe, e as linhas animadas não valem o espaço numa tela de 390px.
 */
function BannerCelular({ marca, nome }: { marca: Marca | null; nome: string }) {
  const imagem = urlDaImagemDeMarca(marca?.image_url ?? null)
  if (!imagem) return null
  return (
    <header
      className="-mx-4 mb-6 flex min-h-[120px] flex-col justify-end px-4 pb-5 pt-4 text-white sm:-mx-8 sm:px-8 lg:hidden"
      style={{ backgroundImage: `linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,.25) 55%, rgba(0,0,0,.2)), url("${imagem}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}
    >
      <Marca nome={nome} className="[&>span:first-child]:bg-white/15 [&>span:first-child]:text-white [&>span:first-child]:backdrop-blur" />
    </header>
  )
}

/**
 * Login da equipe (/login) e do cliente (/login/cliente): a mesma tela, com o
 * texto de cada público. Dois passos só quando a conta tem a verificação em
 * duas etapas ligada — senão a senha certa já entra. Depois, cada um vai
 * para a própria casa (painel ou portal), ou de volta para onde tentou ir.
 */
export function PaginaLogin() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const contexto = CONTEXTOS[location.pathname.startsWith('/login/cliente') ? 'cliente' : 'equipe']
  const de = (location.state as { de?: string } | null)?.de
  // Google é só para a equipe (adapters.py: cliente não se auto-cadastra) —
  // e mesmo `?erro=` chegando aqui via /login/cliente por engano, não faz
  // sentido mostrar um aviso sobre um botão que essa tela nem tem.
  const erroGoogle = contexto.publico === 'equipe' ? ERRO_GOOGLE[searchParams.get('erro') ?? ''] : undefined
  // textos e imagem do painel: do admin, ou o padrão se a API não responder;
  // enquanto carrega, o painel fica sem texto para não piscar o padrão
  const marcaQuery = useMarcaLogin()
  const marca: Marca | null = marcaQuery.data ? marcaQuery.data[contexto.publico] : marcaQuery.isError ? MARCA_PADRAO[contexto.publico] : null
  const nomeDaMarca = marca?.brand_name ?? MARCA_PADRAO[contexto.publico].brand_name

  const [passo, setPasso] = useState<'credenciais' | 'codigo'>('credenciais')
  const [metodo, setMetodo] = useState<'email' | 'totp'>('email')
  const [email, setEmail] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [reenvioEm, setReenvioEm] = useState(0)
  const [reenviado, setReenviado] = useState(false)
  const idBase = useId()
  const campoCodigoRef = useRef<HTMLInputElement>(null)

  const login = useLogin()
  const confirmar2fa = useConfirmar2fa()
  const reenviar2fa = useReenviar2fa()
  const form = useForm<Credenciais>({ resolver: zodResolver(esquemaCredenciais) })

  // contagem regressiva do "reenviar código"
  useEffect(() => {
    if (reenvioEm <= 0) return
    const t = setTimeout(() => setReenvioEm((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [reenvioEm])

  useEffect(() => {
    if (passo === 'codigo') campoCodigoRef.current?.focus()
  }, [passo])

  function entrar(me: Me) {
    queryClient.setQueryData(['me'], me)
    navigate(destinoDepoisDoLogin(me, de), { replace: true })
  }

  async function enviarCredenciais(dados: Credenciais) {
    try {
      const resposta = await login.mutateAsync(dados)
      if (precisaDeCodigo(resposta)) {
        setEmail(dados.email)
        setMetodo(resposta.two_factor === 'totp' ? 'totp' : 'email')
        setCodigo('')
        setReenvioEm(REENVIO_SEGUNDOS)
        setPasso('codigo')
        return
      }
      entrar(resposta)
    } catch {
      // o erro fica em login.error e vira o alerta abaixo
    }
  }

  async function enviarCodigo(valor = codigo) {
    if (valor.length !== 6 || confirmar2fa.isPending) return
    try {
      entrar(await confirmar2fa.mutateAsync({ code: valor }))
    } catch {
      // idem: confirmar2fa.error
    }
  }

  function voltar() {
    confirmar2fa.reset()
    login.reset()
    setCodigo('')
    setPasso('credenciais')
  }

  function reenviar() {
    setReenviado(false)
    reenviar2fa.mutate(undefined, {
      onSuccess: () => {
        setReenviado(true)
        setReenvioEm(REENVIO_SEGUNDOS)
      },
    })
  }

  const erro = passo === 'credenciais' ? login.error : (confirmar2fa.error ?? reenviar2fa.error)
  const idErro = `${idBase}-erro`

  const temImagem = Boolean(marca?.image_url)

  return (
    <div className="min-h-screen bg-canvas text-tinta lg:grid lg:h-screen lg:grid-cols-2 lg:overflow-hidden">
      {/* ---------------------------------------------------- lado da marca */}
      <PainelDaMarca marca={marca} nome={nomeDaMarca} icones={contexto.icones} />

      {/* ------------------------------------------------------ formulário */}
      <main className="relative isolate flex min-h-screen flex-col px-4 pb-6 pt-4 sm:px-8 lg:min-h-0 lg:px-12 lg:py-8">
      <Brilhos />
      <BannerCelular marca={marca} nome={nomeDaMarca} />
      <div className={cn('flex items-center justify-end', temImagem && 'lg:flex')}>
        <AlternarTema />
      </div>

        <div className="flex flex-1 items-start py-2 lg:items-center lg:py-8">
          <div className="mx-auto w-full max-w-[400px]">
            {passo === 'credenciais' ? (
              <form className="flex flex-col gap-5" onSubmit={form.handleSubmit(enviarCredenciais)} noValidate aria-busy={login.isPending}>
                {!temImagem && <Marca nome={nomeDaMarca} className="lg:hidden" />}
                <header>
                  <h1 className="text-titulo-lg font-forte tracking-display">{contexto.titulo}</h1>
                  <p className="mt-1 text-pequeno text-tinta-secundaria">{contexto.subtitulo}</p>
                </header>

                {erro != null && (
                  <Alert id={idErro} variant="destructive" titulo={erro instanceof ApiError && erro.status === 400 ? 'Não deu para entrar' : 'Tente de novo'}>
                    {mensagemDeErro(erro)}
                  </Alert>
                )}
                {erro == null && erroGoogle && (
                  <Alert variant="destructive" titulo="Não deu para entrar com o Google">
                    {erroGoogle}
                  </Alert>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${idBase}-email`}>E-mail</Label>
                  <Input
                    id={`${idBase}-email`}
                    type="email"
                    autoComplete="username"
                    inputMode="email"
                    autoFocus
                    placeholder={contexto.placeholderEmail}
                    aria-invalid={Boolean(form.formState.errors.email) || undefined}
                    aria-describedby={form.formState.errors.email ? `${idBase}-email-erro` : undefined}
                    {...form.register('email')}
                  />
                  <ErroCampo id={`${idBase}-email-erro`}>{form.formState.errors.email?.message}</ErroCampo>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${idBase}-senha`}>Senha</Label>
                  <div className="relative">
                    <Input
                      id={`${idBase}-senha`}
                      type={mostrarSenha ? 'text' : 'password'}
                      autoComplete="current-password"
                      className="pr-11"
                      aria-invalid={Boolean(form.formState.errors.password) || undefined}
                      aria-describedby={form.formState.errors.password ? `${idBase}-senha-erro` : undefined}
                      {...form.register('password')}
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarSenha((v) => !v)}
                      className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-tinta-secundaria hover:bg-navegacao hover:text-tinta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40"
                      aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                      aria-pressed={mostrarSenha}
                    >
                      {mostrarSenha ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <ErroCampo id={`${idBase}-senha-erro`}>{form.formState.errors.password?.message}</ErroCampo>
                </div>

                <Button type="submit" size="lg" className="mt-1 w-full" disabled={login.isPending}>
                  {login.isPending ? 'Entrando…' : 'Entrar'}
                </Button>

                <p className="text-legenda text-tinta-secundaria">
                  Esqueceu a senha? A redefinição é feita por um administrador: fale com o suporte
                  {contexto.publico === 'cliente' ? ' ou com o responsável pela sua empresa' : ''}.
                </p>
              </form>
            ) : (
              <form
                className="flex flex-col gap-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  void enviarCodigo()
                }}
                noValidate
                aria-busy={confirmar2fa.isPending}
              >
                <button type="button" onClick={voltar} className="inline-flex w-fit items-center gap-1 text-pequeno text-tinta-secundaria hover:text-tinta">
                  <ArrowLeft className="size-4" aria-hidden="true" /> Voltar
                </button>
                <header className="flex flex-col gap-3">
                  <span className="grid size-12 place-items-center rounded-xl bg-acento-suave text-acento">
                    {metodo === 'totp' ? <Smartphone className="size-6" aria-hidden="true" /> : <MailCheck className="size-6" aria-hidden="true" />}
                  </span>
                  <div>
                    <h1 className="text-titulo-lg font-forte tracking-display">Confirme que é você</h1>
                    <p className="mt-1 text-pequeno text-tinta-secundaria">
                      {metodo === 'totp' ? (
                        'Abra o aplicativo autenticador e digite o código de 6 dígitos.'
                      ) : (
                        <>
                          Enviamos um código de 6 dígitos para <strong className="text-tinta">{email}</strong>. Ele vale por 10 minutos.
                        </>
                      )}
                    </p>
                  </div>
                </header>

                {erro != null && (
                  <Alert id={idErro} variant="destructive" titulo="Código não aceito">
                    {mensagemDeErro(erro)}
                  </Alert>
                )}
                {reenviado && erro == null && (
                  <Alert variant="success" titulo="Código reenviado">
                    Confira a caixa de entrada e o spam.
                  </Alert>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${idBase}-codigo`}>Código</Label>
                  <Input
                    ref={campoCodigoRef}
                    id={`${idBase}-codigo`}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={codigo}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                      setCodigo(v)
                      confirmar2fa.reset()
                      if (v.length === 6) void enviarCodigo(v)
                    }}
                    className="h-14 text-center text-titulo font-forte tracking-[0.4em]"
                    aria-invalid={erro != null || undefined}
                    aria-describedby={erro != null ? idErro : undefined}
                  />
                </div>

                <Button type="submit" size="lg" className="w-full" disabled={codigo.length !== 6 || confirmar2fa.isPending}>
                  {confirmar2fa.isPending ? 'Confirmando…' : 'Confirmar'}
                </Button>

                {metodo === 'email' && (
                  <p className="text-center text-legenda text-tinta-secundaria">
                    Não chegou?{' '}
                    {reenvioEm > 0 ? (
                      <span>Reenviar em {reenvioEm}s</span>
                    ) : (
                      <button type="button" onClick={reenviar} disabled={reenviar2fa.isPending} className="font-medio text-acento hover:underline disabled:opacity-60">
                        {reenviar2fa.isPending ? 'Reenviando…' : 'Reenviar código'}
                      </button>
                    )}
                  </p>
                )}
              </form>
            )}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-center text-legenda text-tinta-secundaria sm:justify-between">
          <span>
            {contexto.outroPublico.pergunta}{' '}
            <Link to={contexto.outroPublico.rota} className="font-medio text-acento hover:underline">
              {contexto.outroPublico.acao}
            </Link>
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-3.5" aria-hidden="true" /> Conexão segura · verificação em duas etapas disponível
          </span>
        </footer>
      </main>
    </div>
  )
}
