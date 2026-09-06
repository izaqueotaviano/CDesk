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
import { API_BASE_URL, ApiError } from '@/api/client'
import type { Me } from '@/api/types'
import { cn } from '@/portal/lib/cn'
import { AlternarTema } from '@/portal/shell/PortalShell'
import { Alert } from '@/portal/ui/alert'
import { Button, buttonVariants } from '@/portal/ui/button'
import { ErroCampo, Input, Label } from '@/portal/ui/input'

/** `?erro=` na volta do redirect do allauth (`apps/accounts/adapters.py`,
 *  `SocialAccountAdapter.pre_social_login`) — a única forma de o backend
 *  avisar algo aqui, já que esse fluxo é redirect de navegador, não fetch. */
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

/**
 * O painel da marca (desktop): azul da casa, ou a imagem que o admin enviou
 * com um degradê por baixo dos textos. Sem chamada nem destaques, a imagem
 * fala sozinha.
 */
function PainelDaMarca({ marca, icones }: { marca: Marca | null; icones: LucideIcon[] }) {
  const imagem = urlDaImagemDeMarca(marca?.image_url ?? null)
  const temTexto = Boolean(marca && (marca.headline || marca.highlights.length > 0))
  return (
    <aside
      className={cn(
        'relative hidden flex-col justify-between overflow-hidden px-12 py-12 text-white lg:flex',
        // azul fixo nos dois temas: é a marca, não a superfície — no escuro o
        // token de acento vira azul-claro e o painel perderia o contraste
        !imagem && 'bg-gradient-to-br from-[#1b63d6] to-[#0d3f96]',
      )}
      style={imagem ? { backgroundImage: `url("${imagem}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      aria-hidden="true"
    >
      {imagem ? (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/20" />
      ) : (
        <>
          <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-total bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-total bg-black/10 blur-3xl" />
        </>
      )}
      <div className="relative flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-white/15 text-titulo-sm font-forte backdrop-blur">r</span>
        <span className="text-corpo-lg font-forte tracking-display">{marca?.brand_name ?? ''}</span>
      </div>
      <div className="relative flex flex-col gap-8">
        {marca && temTexto && (
          <>
            {marca.headline && <h2 className="max-w-md text-display font-forte leading-justa tracking-display">{marca.headline}</h2>}
            <ul className="flex max-w-md flex-col gap-4">
              {marca.highlights.map((texto, i) => {
                const Icone = icones[i] ?? icones[icones.length - 1]
                return (
                  <li key={texto} className="flex items-start gap-3 text-corpo text-white/90">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/15 backdrop-blur">
                      <Icone className="size-4" />
                    </span>
                    {texto}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
      <p className="relative text-legenda text-white/70">Resolv · sistema de atendimento</p>
    </aside>
  )
}

/**
 * O painel no celular: um banner compacto no topo, com a mesma imagem (ou o
 * mesmo azul), a marca e a chamada — os destaques ficam só no desktop, onde
 * há espaço. Sangra até as bordas da tela; o formulário vem logo abaixo.
 */
function BannerCelular({ marca, nome }: { marca: Marca | null; nome: string }) {
  const imagem = urlDaImagemDeMarca(marca?.image_url ?? null)
  const chamada = marca?.headline ?? ''
  return (
    <header
      className={cn(
        '-mx-4 mb-6 flex flex-col justify-between gap-6 px-4 pb-6 pt-4 text-white sm:-mx-8 sm:px-8 lg:hidden',
        chamada ? 'min-h-[196px]' : 'min-h-[104px]',
        !imagem && 'bg-gradient-to-br from-[#1b63d6] to-[#0d3f96]',
      )}
      style={imagem ? { backgroundImage: `linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,.25) 55%, rgba(0,0,0,.2)), url("${imagem}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/15 text-corpo-lg font-forte backdrop-blur">r</span>
          <span className="truncate text-corpo-lg font-forte tracking-display">{nome}</span>
        </div>
        <AlternarTema className="text-white hover:bg-white/15 hover:text-white" />
      </div>
      {chamada && <h2 className="max-w-sm text-titulo font-forte leading-justa tracking-display">{chamada}</h2>}
    </header>
  )
}

/** O "G" colorido do Google — não é um ícone da lucide (é logo de marca, não
 *  glifo genérico), então vem inline em SVG, só aqui onde é usado. */
function GoogleG() {
  return (
    <svg className="size-4" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.6 15.4 18.9 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4c-7.4 0-13.8 4.1-17.1 10.2z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.5-2.1 14.2-5.5l-6.6-5.6C29.6 34.6 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.6 5.1C9.1 39.6 15.9 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.6 5.6C41.4 36 44 30.6 44 24c0-1.3-.1-2.7-.4-3.5z" />
    </svg>
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

  return (
    <div className="min-h-screen bg-canvas text-tinta">
      <div className="mx-auto grid min-h-screen w-full max-w-6xl lg:grid-cols-[1.1fr_1fr]">
        {/* ---------------------------------------------------- lado da marca */}
        <PainelDaMarca marca={marca} icones={contexto.icones} />

        {/* ------------------------------------------------------ formulário */}
        <main className="relative flex flex-col px-4 pb-6 sm:px-8 lg:px-12 lg:py-10">
          <BannerCelular marca={marca} nome={nomeDaMarca} />
          <div className="hidden items-center justify-end lg:flex">
            <AlternarTema />
          </div>

          <div className="flex flex-1 items-start py-2 lg:items-center lg:py-8">
            <div className="mx-auto w-full max-w-[420px]">
              {passo === 'credenciais' ? (
                <form className="flex flex-col gap-5" onSubmit={form.handleSubmit(enviarCredenciais)} noValidate aria-busy={login.isPending}>
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

                  {contexto.publico === 'equipe' && (
                    <>
                      <a
                        href={`${API_BASE_URL}/accounts/google/login/`}
                        className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full gap-2.5')}
                      >
                        <GoogleG />
                        Continuar com o Google
                      </a>
                      <div className="flex items-center gap-3 text-legenda text-tinta-secundaria" role="separator">
                        <span className="h-px flex-1 bg-divisoria" aria-hidden="true" />
                        ou entre com e-mail e senha
                        <span className="h-px flex-1 bg-divisoria" aria-hidden="true" />
                      </div>
                    </>
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
    </div>
  )
}
