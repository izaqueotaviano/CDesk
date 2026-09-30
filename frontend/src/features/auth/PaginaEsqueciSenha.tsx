import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { IconArrowLeft, IconMailForward } from '@tabler/icons-react'
import { cn } from '@/portal/lib/cn'
import { Alert } from '@/portal/ui/alert'
import { Button, buttonVariants } from '@/portal/ui/button'
import { ErroCampo, Input, Label } from '@/portal/ui/input'
import { usePedirLinkDeSenha } from './api'
import { mensagemDeErro } from './erros'
import { LayoutLogin } from './LayoutLogin'
import { PUBLICOS, publicoDaRota } from './publicos'

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * "Esqueci minha senha" — `/login/esqueci-senha` (equipe) e
 * `/login/cliente/esqueci-senha` (cliente).
 *
 * A confirmação é a MESMA exista a conta ou não ("Se existir uma conta com
 * esse e-mail…"): é o que o servidor responde, e a tela não inventa um
 * "enviamos!" que ela não tem como saber. O link que chega vale 1 hora.
 */
export function PaginaEsqueciSenha() {
  const location = useLocation()
  const publico = publicoDaRota(location.pathname)
  const contexto = PUBLICOS[publico]
  const emailDoLogin = (location.state as { email?: string } | null)?.email ?? ''
  const idBase = useId()
  const pedir = usePedirLinkDeSenha()
  const [email, setEmail] = useState(emailDoLogin)
  const [erroCampo, setErroCampo] = useState<string | undefined>()
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null)
  const tituloConfirmacaoRef = useRef<HTMLHeadingElement>(null)

  // O foco segue a troca de estado: quem usa leitor de tela ouve o título
  // da confirmação em vez de ficar parado num botão que sumiu.
  useEffect(() => {
    if (enviadoPara) tituloConfirmacaoRef.current?.focus()
  }, [enviadoPara])

  function enviar(e: FormEvent) {
    e.preventDefault()
    const limpo = email.trim()
    if (!EMAIL_VALIDO.test(limpo)) {
      setErroCampo('Informe um e-mail válido, como nome@empresa.com.br.')
      return
    }
    setErroCampo(undefined)
    pedir.mutate(limpo, { onSuccess: () => setEnviadoPara(limpo) })
  }

  function usarOutroEmail() {
    pedir.reset()
    setEnviadoPara(null)
  }

  const voltar = (
    <Link to={contexto.rotaLogin} state={{ email: (enviadoPara ?? email).trim() || undefined }} className="login-link inline-flex w-fit items-center gap-1.5 text-corpo">
      <IconArrowLeft className="size-4" aria-hidden="true" />
      Voltar para o login
    </Link>
  )

  if (enviadoPara) {
    return (
      <LayoutLogin publico={publico}>
        <div className="flex flex-col gap-5">
          <span className="grid size-10 place-items-center rounded-md bg-navegacao text-tinta">
            <IconMailForward className="size-5" stroke={1.75} aria-hidden="true" />
          </span>
          <div>
            <h1 ref={tituloConfirmacaoRef} tabIndex={-1} className="text-titulo-lg font-forte outline-none">
              Confira seu e-mail
            </h1>
            <p className="mt-2 text-corpo text-tinta-secundaria" role="status">
              Se existir uma conta com esse e-mail (<strong className="font-medio text-tinta">{enviadoPara}</strong>), enviamos um link para
              criar uma senha nova. Ele vale por 1 hora e só funciona uma vez.
            </p>
          </div>
          <p className="text-corpo text-tinta-secundaria">
            Não chegou em alguns minutos? Confira o spam e se o e-mail está certo.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link to={contexto.rotaLogin} state={{ email: enviadoPara }} className={cn(buttonVariants({ size: 'lg' }), 'h-11 flex-1')}>
              Voltar para o login
            </Link>
            <Button variant="secondary" size="lg" className="h-11 flex-1 border-borda-campo" onClick={usarOutroEmail}>
              Usar outro e-mail
            </Button>
          </div>
        </div>
      </LayoutLogin>
    )
  }

  return (
    <LayoutLogin publico={publico}>
      <form className="flex flex-col gap-5" onSubmit={enviar} noValidate aria-busy={pedir.isPending}>
        {voltar}
        <header>
          <h1 className="text-titulo-lg font-forte">Esqueci minha senha</h1>
          <p className="mt-2 text-corpo text-tinta-secundaria">
            Informe o e-mail da sua conta. Vamos enviar um link para você criar uma senha nova.
          </p>
        </header>

        {pedir.error != null && (
          <Alert variant="destructive" titulo="Não deu para enviar o link">
            {mensagemDeErro(pedir.error)}
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
            autoFocus
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (erroCampo) setErroCampo(undefined)
            }}
            className="login-campo h-11 text-corpo focus-visible:border-borda-campo"
            placeholder={contexto.placeholderEmail}
            aria-invalid={Boolean(erroCampo) || undefined}
            aria-describedby={erroCampo ? `${idBase}-email-erro` : undefined}
          />
          <ErroCampo id={`${idBase}-email-erro`}>{erroCampo}</ErroCampo>
        </div>

        <Button type="submit" size="lg" className="h-11 w-full" disabled={pedir.isPending}>
          {pedir.isPending ? 'Enviando…' : 'Enviar link'}
        </Button>

      </form>
    </LayoutLogin>
  )
}
