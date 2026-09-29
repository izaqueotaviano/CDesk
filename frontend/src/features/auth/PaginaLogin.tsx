import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
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
  /** Rótulo em versalete acima do título — o `.ds-eyebrow` do Convertize.
   *  Fala do PÚBLICO, não da marca, que o admin renomeia. */
  eyebrow: string
  /** Classes `ti ti-*` do webfont Tabler — a única família do produto. */
  icones: string[]
  placeholderEmail: string
  outroPublico: { pergunta: string; acao: string; rota: string }
}

const CONTEXTOS: Record<PublicoLogin, Contexto> = {
  cliente: {
    publico: 'cliente',
    titulo: 'Entrar no portal',
    subtitulo: 'Acompanhe seus chamados, fale com a equipe e avalie o atendimento.',
    eyebrow: 'Acesso do cliente',
    icones: ['ti ti-ticket', 'ti ti-headset', 'ti ti-lifebuoy'],
    placeholderEmail: 'voce@suaempresa.com.br',
    outroPublico: { pergunta: 'É da equipe de suporte?', acao: 'Entrar no painel', rota: '/login' },
  },
  equipe: {
    publico: 'equipe',
    titulo: 'Entrar no painel',
    subtitulo: 'A fila, o chat e os indicadores da equipe.',
    eyebrow: 'Acesso da equipe',
    icones: ['ti ti-ticket', 'ti ti-headset', 'ti ti-shield-check'],
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
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-laranja text-white">
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
 * O painel da direita (desktop): a grade de 64px sobre a tinta do acento
 * (login.css) — ou a foto que o admin enviou, aí a grade sai e entra um véu
 * escuro pro cartão continuar legível por cima. O cartão de destaques mora
 * embaixo, como a citação da referência, e o rodapé em mono fecha o painel.
 *
 * Não é `aria-hidden`: headline e destaques são texto de verdade, e o leitor
 * de tela lê depois do formulário (ordem do DOM), que é onde interessa.
 */
function PainelDaMarca({ marca, icones }: { marca: Marca | null; icones: string[] }) {
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

      {/* Centrado, e sem cartão. Num campo calmo o texto não precisa de
          moldura — é a mesma regra que o briefing dá para a resposta no chat
          ("sem balão, texto direto sobre o fundo, largura de leitura"). Com
          a grade que saiu, um cartão pequeno ancorado no canto deixava 600px
          de carvão morto em cima; centrar faz o texto ocupar o campo, que é
          o trabalho dele. */}
      <div className="relative flex h-full flex-col justify-center gap-10 p-10 xl:p-16">
        {marca && temTexto && (
          <div className="login-painel__bloco max-w-[42ch]">
            {marca.headline && (
              <p className="text-titulo-lg font-normal leading-justa tracking-display text-[#faf9f5]">{marca.headline}</p>
            )}
            {marca.highlights.length > 0 && (
              <ul className={cn('flex flex-col gap-4 text-corpo leading-solta text-[#b5b3ae]', marca.headline && 'mt-8')}>
                {marca.highlights.map((texto, i) => {
                  const icone = icones[i] ?? icones[icones.length - 1]
                  return (
                    <li key={texto} className="flex items-start gap-3">
                      {/* Cor fixa, e não `text-acento`: o acento virou o
                          próprio carvão, e sobre o painel escuro isso seria
                          carvão em cima de carvão — ícone invisível. */}
                      <i className={`login-destaque__icone mt-1 shrink-0 text-[#8b8983] ${icone}`} aria-hidden="true" />
                      {texto}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
        <p className={cn('login-painel__rodape text-legenda', imagem ? 'text-white/75' : 'text-[#8b8983]')}>
          Resolv · sistema de atendimento
        </p>
      </div>
    </aside>
  )
}

/**
 * No celular o painel inteiro não cabe: a foto do admin (se houver) vira uma
 * faixa curta no topo, e os destaques ficam de fora — numa tela de 390px o
 * que importa é o formulário acima da dobra. Sem foto, nem faixa: uma tira
 * de cor lisa só empurraria o campo pra baixo.
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

/**
 * Login da equipe (/login) e do cliente (/login/cliente): a mesma tela, com o
 * texto de cada público. Dois passos só quando a conta tem a verificação em
 * duas etapas ligada — senão a senha certa já entra. Depois, cada um vai
 * para a própria casa (painel ou portal), ou de volta para onde tentou ir.
 *
 * Desenho de planta baixa (referência: a tela de cadastro da Relume):
 * formulário numa coluna estreita à ESQUERDA, com a moldura de linhas
 * passando dos cantos, e o painel de marca à direita.
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
  // O subtítulo do admin é o que fica sob o título, como na referência; o do
  // contexto cobre o intervalo até a marca chegar.
  const subtitulo = marca?.subtitle || contexto.subtitulo

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
    <div className="relative min-h-screen bg-canvas text-tinta lg:grid lg:h-screen lg:grid-cols-[1fr_minmax(340px,42%)] lg:overflow-hidden">
      {/* Troca de público + tema, num nó só: no desktop flutua sobre o painel
          da direita (o lugar do "Sign in" da referência), no celular sobre o
          próprio formulário. Dois blocos por breakpoint dariam dois links de
          mesmo nome no DOM. */}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
        <span className="login-troca__pergunta hidden text-legenda text-tinta-secundaria sm:inline">{contexto.outroPublico.pergunta}</span>
        <Link
          to={contexto.outroPublico.rota}
          className="inline-flex h-8 items-center rounded-md border border-divisoria bg-superficie px-3 text-pequeno font-medio text-tinta transition-colors hover:bg-navegacao"
        >
          {contexto.outroPublico.acao}
        </Link>
        <AlternarTema className="size-8 border border-divisoria bg-superficie hover:bg-navegacao" />
      </div>

      {/* ------------------------------------------------------ formulário */}
      <main className="flex min-h-screen flex-col px-4 pb-8 pt-4 sm:px-8 lg:min-h-0 lg:px-12 lg:py-6">
        <FaixaCelular marca={marca} />
        {/* Abaixo de `lg` a marca divide a linha com o bloco flutuante do
            canto direito: o teto de largura corta o nome com reticências em
            vez de deixar os dois se sobreporem (o nome vem do admin, pode
            ser longo). */}
        <Marca nome={nomeDaMarca} className="max-w-[52%] lg:max-w-none" />

        <div className="flex flex-1 items-start py-10 lg:items-center lg:py-0">
          <div className="login-cartao relative mx-auto w-full max-w-[372px]">
            {passo === 'credenciais' ? (
              <form className="relative flex flex-col gap-4" onSubmit={form.handleSubmit(enviarCredenciais)} noValidate aria-busy={login.isPending}>
                <header className="login-cabecalho">
                  <h1 className="login-titulo text-titulo font-forte tracking-display">{contexto.titulo}</h1>
                  <p className="mt-2 text-pequeno leading-normal text-tinta-secundaria">{subtitulo}</p>
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

                <div className="mt-2 flex flex-col gap-1.5">
                  <Label htmlFor={`${idBase}-email`}>E-mail</Label>
                  <Input
                    id={`${idBase}-email`}
                    type="email"
                    autoComplete="username"
                    inputMode="email"
                    autoFocus
                    className="login-campo h-9"
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
                      className="login-campo h-9 pr-10"
                      aria-invalid={Boolean(form.formState.errors.password) || undefined}
                      aria-describedby={form.formState.errors.password ? `${idBase}-senha-erro` : undefined}
                      {...form.register('password')}
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarSenha((v) => !v)}
                      className="absolute right-0.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-tinta-secundaria hover:bg-navegacao hover:text-tinta"
                      aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                      aria-pressed={mostrarSenha}
                    >
                      {mostrarSenha ? <i className="ti ti-eye-off" /> : <i className="ti ti-eye" />}
                    </button>
                  </div>
                  <ErroCampo id={`${idBase}-senha-erro`}>{form.formState.errors.password?.message}</ErroCampo>
                </div>

                <Button type="submit" className="mt-1 h-[44px] w-full" disabled={login.isPending}>
                  {login.isPending ? 'Entrando…' : 'Entrar'}
                </Button>

                <p className="login-nota text-legenda leading-normal text-tinta-terciaria">
                  Esqueceu a senha? A redefinição é feita por um administrador: fale com o suporte
                  {contexto.publico === 'cliente' ? ' ou com o responsável pela sua empresa' : ''}.
                </p>
              </form>
            ) : (
              <form
                className="relative flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  void enviarCodigo()
                }}
                noValidate
                aria-busy={confirmar2fa.isPending}
              >
                <button type="button" onClick={voltar} className="inline-flex w-fit items-center gap-1 text-pequeno text-tinta-secundaria hover:text-tinta">
                  <i className="ti ti-arrow-left" aria-hidden="true" /> Voltar
                </button>
                <header className="flex flex-col items-center gap-3 text-center">
                  <span className="login-selo-2fa grid size-11 place-items-center rounded-md bg-acento-suave text-acento">
                    {metodo === 'totp' ? <i className="ti ti-device-mobile" aria-hidden="true" /> : <i className="ti ti-mail-check" aria-hidden="true" />}
                  </span>
                  <div>
                    <p className="login-eyebrow">Verificação em duas etapas</p>
                    <h1 className="login-titulo text-titulo font-forte tracking-display">Confirme que é você</h1>
                    <p className="mt-2 text-pequeno leading-normal text-tinta-secundaria">
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
                    className="h-12 text-center text-titulo font-forte tracking-[0.4em]"
                    aria-invalid={erro != null || undefined}
                    aria-describedby={erro != null ? idErro : undefined}
                  />
                </div>

                <Button type="submit" className="h-[44px] w-full" disabled={codigo.length !== 6 || confirmar2fa.isPending}>
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

        <footer className="flex items-center justify-center gap-1 text-center text-legenda text-tinta-terciaria">
          <i className="ti ti-shield-check shrink-0" aria-hidden="true" /> Conexão segura · verificação em duas etapas disponível
        </footer>
      </main>

      {/* ---------------------------------------------------- lado da marca */}
      <PainelDaMarca marca={marca} icones={contexto.icones} />
    </div>
  )
}
