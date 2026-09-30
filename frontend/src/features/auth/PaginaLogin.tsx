import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useId, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { IconArrowLeft, IconDeviceMobile, IconEye, IconEyeOff, IconMailCheck } from '@tabler/icons-react'
import { z } from 'zod'
import { useConfirmar2fa, useReenviar2fa } from '@/api/mutations/use2fa'
import { precisaDeCodigo, useLogin } from '@/api/mutations/useLogin'
import { ApiError } from '@/api/client'
import type { Me } from '@/api/types'
import { Alert } from '@/portal/ui/alert'
import { Button } from '@/portal/ui/button'
import { ErroCampo, Input, Label } from '@/portal/ui/input'
import { mensagemDeErro } from './erros'
import { LayoutLogin } from './LayoutLogin'
import { PUBLICOS, publicoDaRota, useMarcaDoPublico } from './publicos'

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

const TITULO = { cliente: 'Entrar no portal', equipe: 'Entrar no painel' } as const
const SUBTITULO = {
  cliente: 'Acompanhe seus tickets, fale com a equipe e avalie o atendimento.',
  equipe: 'A fila, o chat e os indicadores da equipe.',
} as const

/** Título do alerta de erro: diz O QUE aconteceu, o texto embaixo diz o que
 *  fazer. Trava de tentativas é outra coisa que senha errada. */
function tituloDoErro(e: unknown): string {
  if (e instanceof ApiError && e.status === 429) return 'Entrada pausada por segurança'
  if (e instanceof ApiError && e.status === 400) return 'Não deu para entrar'
  return 'Tente de novo'
}

/** Para onde ir depois de entrar: de onde a pessoa veio, se fizer sentido
 *  para o tipo de conta; senão, a casa de cada um. */
function destinoDepoisDoLogin(me: Me, de: string | undefined): string {
  if (me.is_internal) return de && !de.startsWith('/portal') && !de.startsWith('/login') ? de : '/inicio'
  return de && de.startsWith('/portal') ? de : '/portal'
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
  const publico = publicoDaRota(location.pathname)
  const contexto = PUBLICOS[publico]
  const estado = location.state as { de?: string; email?: string } | null
  const de = estado?.de
  // Google é só para a equipe (adapters.py: cliente não se auto-cadastra) —
  // e mesmo `?erro=` chegando aqui via /login/cliente por engano, não faz
  // sentido mostrar um aviso sobre um botão que essa tela nem tem.
  const erroGoogle = publico === 'equipe' ? ERRO_GOOGLE[searchParams.get('erro') ?? ''] : undefined
  // O subtítulo do admin fica sob o título; o fixo cobre o intervalo até a
  // marca chegar (e o caso de a API não responder).
  const marca = useMarcaDoPublico(publico)
  const subtitulo = marca?.subtitle || SUBTITULO[publico]

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
  // Quem acabou de criar a senha nova chega com o e-mail no `state`: ele
  // já vem preenchido e o foco vai direto para a senha.
  const emailInicial = estado?.email ?? ''
  const form = useForm<Credenciais>({
    resolver: zodResolver(esquemaCredenciais),
    defaultValues: { email: emailInicial, password: '' },
  })

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
  const emailDigitado = useWatch({ control: form.control, name: 'email' })
  const campoEmail = form.register('email')

  return (
    <LayoutLogin publico={publico} comTrocaDePublico>
      {passo === 'credenciais' ? (
        <form className="flex flex-col gap-5" onSubmit={form.handleSubmit(enviarCredenciais)} noValidate aria-busy={login.isPending}>
          <header>
            <h1 className="text-titulo-lg font-forte">{TITULO[publico]}</h1>
            <p className="mt-2 text-corpo text-tinta-secundaria">{subtitulo}</p>
          </header>

          {erro != null && (
            <Alert id={idErro} variant="destructive" titulo={tituloDoErro(erro)}>
              {mensagemDeErro(erro)}
            </Alert>
          )}
          {erro == null && erroGoogle && (
            <Alert variant="destructive" titulo="Não deu para entrar com o Google">
              {erroGoogle}
            </Alert>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idBase}-email`} className="text-corpo">
              E-mail
            </Label>
            <Input
              id={`${idBase}-email`}
              type="email"
              autoComplete="username"
              inputMode="email"
              autoFocus={!emailInicial}
              className="login-campo h-11 text-corpo focus-visible:border-borda-campo"
              placeholder={contexto.placeholderEmail}
              aria-invalid={Boolean(form.formState.errors.email) || undefined}
              aria-describedby={form.formState.errors.email ? `${idBase}-email-erro` : undefined}
              {...campoEmail}
            />
            <ErroCampo id={`${idBase}-email-erro`}>{form.formState.errors.email?.message}</ErroCampo>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idBase}-senha`} className="text-corpo">
              Senha
            </Label>
            <div className="relative">
              <Input
                id={`${idBase}-senha`}
                type={mostrarSenha ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus={Boolean(emailInicial)}
                className="login-campo h-11 pr-11 text-corpo focus-visible:border-borda-campo"
                aria-invalid={Boolean(form.formState.errors.password) || undefined}
                aria-describedby={form.formState.errors.password ? `${idBase}-senha-erro` : undefined}
                {...form.register('password')}
              />
              <button
                type="button"
                onClick={() => setMostrarSenha((v) => !v)}
                className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-tinta-secundaria hover:bg-navegacao hover:text-tinta"
                aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={mostrarSenha}
              >
                {mostrarSenha ? <IconEyeOff className="size-4" aria-hidden="true" /> : <IconEye className="size-4" aria-hidden="true" />}
              </button>
            </div>
            <ErroCampo id={`${idBase}-senha-erro`}>{form.formState.errors.password?.message}</ErroCampo>
          </div>

          <Button type="submit" size="lg" className="h-11 w-full" disabled={login.isPending}>
            {login.isPending ? 'Entrando…' : 'Entrar'}
          </Button>

          {/* Depois do botão, na ordem do Tab: quem sabe a senha não passa
              por aqui a caminho do "Entrar". O e-mail já digitado vai junto. */}
          <Link
            to={contexto.rotaEsqueci}
            state={{ email: emailDigitado?.trim() || undefined }}
            className="login-link w-fit text-corpo"
          >
            Esqueci minha senha
          </Link>
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
          <button
            type="button"
            onClick={voltar}
            className="inline-flex w-fit items-center gap-1.5 rounded-sm text-corpo text-tinta-secundaria hover:text-tinta"
          >
            <IconArrowLeft className="size-4" aria-hidden="true" /> Voltar
          </button>
          <header className="flex flex-col gap-3">
            <span className="grid size-10 place-items-center rounded-md bg-navegacao text-tinta">
              {metodo === 'totp' ? <IconDeviceMobile className="size-5" stroke={1.75} aria-hidden="true" /> : <IconMailCheck className="size-5" stroke={1.75} aria-hidden="true" />}
            </span>
            <div>
              <p className="text-pequeno font-medio text-tinta-secundaria">Verificação em duas etapas</p>
              <h1 className="mt-1 text-titulo-lg font-forte">Confirme que é você</h1>
              <p className="mt-2 text-corpo text-tinta-secundaria">
                {metodo === 'totp' ? (
                  'Abra o aplicativo autenticador e digite o código de 6 dígitos.'
                ) : (
                  <>
                    Enviamos um código de 6 dígitos para <strong className="font-medio text-tinta">{email}</strong>. Ele vale por 10 minutos.
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
            <Label htmlFor={`${idBase}-codigo`} className="text-corpo">
              Código
            </Label>
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
              className="login-campo h-12 text-center text-titulo font-forte tracking-[0.4em] focus-visible:border-borda-campo"
              aria-invalid={erro != null || undefined}
              aria-describedby={erro != null ? idErro : undefined}
            />
          </div>

          <Button type="submit" size="lg" className="h-11 w-full" disabled={codigo.length !== 6 || confirmar2fa.isPending}>
            {confirmar2fa.isPending ? 'Confirmando…' : 'Confirmar'}
          </Button>

          {metodo === 'email' && (
            <p className="text-corpo text-tinta-secundaria">
              Não chegou?{' '}
              {reenvioEm > 0 ? (
                <span>Reenviar em {reenvioEm}s</span>
              ) : (
                <button type="button" onClick={reenviar} disabled={reenviar2fa.isPending} className="login-link rounded-sm font-medio disabled:opacity-60">
                  {reenviar2fa.isPending ? 'Reenviando…' : 'Reenviar código'}
                </button>
              )}
            </p>
          )}
        </form>
      )}
    </LayoutLogin>
  )
}
