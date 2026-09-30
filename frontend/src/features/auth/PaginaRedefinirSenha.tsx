import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { IconCircleCheck, IconLinkOff } from '@tabler/icons-react'
import { ApiError } from '@/api/client'
import type { PublicoLogin } from '@/api/branding'
import { cn } from '@/portal/lib/cn'
import { Alert } from '@/portal/ui/alert'
import { Button, buttonVariants } from '@/portal/ui/button'
import { ErroCampo, Label } from '@/portal/ui/input'
import { Skeleton } from '@/portal/ui/skeleton'
import { useConferirLinkDeSenha, useSalvarSenhaPeloLink, type ModoSenha } from './api'
import { CampoSenha, ListaDeRegras } from './CampoSenha'
import { mensagemDeErro } from './erros'
import { regrasDaSenha } from './senha'
import { LayoutLogin } from './LayoutLogin'
import { PUBLICOS, publicoDaRota } from './publicos'

const TEXTOS: Record<ModoSenha, { titulo: string; botao: string; salvando: string; sucesso: string; sucessoTexto: string }> = {
  recuperacao: {
    titulo: 'Crie uma senha nova',
    botao: 'Salvar senha nova',
    salvando: 'Salvando…',
    sucesso: 'Senha alterada',
    sucessoTexto: 'Entre com a senha nova. Por segurança, encerramos as sessões abertas em outros aparelhos.',
  },
  convite: {
    titulo: 'Defina sua senha',
    botao: 'Definir senha',
    salvando: 'Salvando…',
    sucesso: 'Senha definida',
    sucessoTexto: 'Seu acesso está pronto. Entre com seu e-mail e a senha que você acabou de criar.',
  },
}

/** A resposta de erro é "link inválido" (e não "senha recusada") quando não
 *  traz erro de campo: é o 400 com `detail` que as duas views mandam para
 *  link vencido, usado ou inexistente. */
function linkRecusado(e: unknown): boolean {
  return e instanceof ApiError && e.status === 400 && (e.code === 'link_invalido' || !e.fieldErrors)
}

/**
 * A senha nova pelo link do e-mail — dois caminhos, uma tela:
 *
 * - `recuperacao`: `/login/redefinir-senha/:uid/:token` (equipe) e
 *   `/login/cliente/redefinir-senha/:uid/:token` (cliente), o link do
 *   "Esqueci minha senha";
 * - `convite`: `/portal/definir-senha/:uid/:token`, o link do convite de
 *   acesso. Esta rota era citada pelo e-mail do convite e não existia na SPA:
 *   quem clicava caía no login sem ter senha para digitar.
 *
 * Confere o link ANTES de mostrar o formulário. Nenhum dos dois cria sessão:
 * o fim é sempre o login (com o 2FA de quem o tem), com o e-mail preenchido.
 */
export function PaginaRedefinirSenha({ modo }: { modo: ModoSenha }) {
  const { uid = '', token = '' } = useParams<{ uid: string; token: string }>()
  const location = useLocation()
  const idBase = useId()
  const conferencia = useConferirLinkDeSenha(modo, uid, token)
  const salvar = useSalvarSenhaPeloLink(modo)
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [tentouEnviar, setTentouEnviar] = useState(false)
  const [linkMorreu, setLinkMorreu] = useState(false)
  const tituloRef = useRef<HTMLHeadingElement>(null)

  const dados = conferencia.data
  // O público vem da conta quando o servidor já disse de quem é o link; até
  // lá, da rota. (O convite mora sob /portal, mas também chega a agentes.)
  const publico: PublicoLogin = dados?.kind === 'internal' ? 'equipe' : dados?.kind === 'client' ? 'cliente' : publicoDaRota(location.pathname)
  const contexto = PUBLICOS[publico]
  const textos = TEXTOS[modo]
  const email = dados?.email ?? ''

  const salva = salvar.isSuccess
  const invalido = linkMorreu || (dados && !dados.valid) || (!uid || !token)

  useEffect(() => {
    if (salva || invalido) tituloRef.current?.focus()
  }, [salva, invalido])

  const regras = regrasDaSenha(senha, confirmacao, email, dados?.full_name ?? '')
  const pronta = regras.every((r) => r.ok)
  const errosDoServidor =
    salvar.error instanceof ApiError ? (salvar.error.fieldErrors?.new_password ?? salvar.error.fieldErrors?.password ?? []) : []

  function enviar(e: FormEvent) {
    e.preventDefault()
    setTentouEnviar(true)
    if (!pronta || salvar.isPending) return
    salvar.mutate(
      { uid, token, senha },
      {
        onError: (err) => {
          if (linkRecusado(err)) setLinkMorreu(true)
        },
      },
    )
  }

  // ------------------------------------------------------------ estados
  if (conferencia.isLoading) {
    return (
      <LayoutLogin publico={publico}>
        <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
          <p className="sr-only">Conferindo o link…</p>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </LayoutLogin>
    )
  }

  if (conferencia.isError) {
    return (
      <LayoutLogin publico={publico}>
        <div className="flex flex-col gap-5">
          <h1 className="text-titulo-lg font-forte">{textos.titulo}</h1>
          <Alert
            variant="destructive"
            titulo="Não deu para conferir o link"
            acao={
              <Button size="sm" variant="secondary" className="border-borda-campo" onClick={() => conferencia.refetch()}>
                Tentar de novo
              </Button>
            }
          >
            {mensagemDeErro(conferencia.error)}
          </Alert>
        </div>
      </LayoutLogin>
    )
  }

  if (invalido) {
    return (
      <LayoutLogin publico={publico}>
        <div className="flex flex-col gap-5">
          <span className="grid size-10 place-items-center rounded-md bg-navegacao text-tinta">
            <IconLinkOff className="size-5" stroke={1.75} aria-hidden="true" />
          </span>
          <div>
            <h1 ref={tituloRef} tabIndex={-1} className="text-titulo-lg font-forte outline-none">
              Este link não vale mais
            </h1>
            <p className="mt-2 text-corpo text-tinta-secundaria">
              {modo === 'recuperacao'
                ? 'Links para criar senha valem por 1 hora e só funcionam uma vez. Peça um novo e use o mais recente que chegar.'
                : 'Convites valem por 3 dias e só funcionam uma vez. Se você já criou a senha, é só entrar. Se não, peça um novo convite a quem convidou você, ou use "Esqueci minha senha".'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to={contexto.rotaEsqueci} className={cn(buttonVariants({ size: 'lg' }), 'h-11 flex-1')}>
              Pedir um link novo
            </Link>
            <Link to={contexto.rotaLogin} className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'h-11 flex-1 border-borda-campo')}>
              Ir para o login
            </Link>
          </div>
        </div>
      </LayoutLogin>
    )
  }

  if (salva) {
    return (
      <LayoutLogin publico={publico}>
        <div className="flex flex-col gap-5">
          <span className="grid size-10 place-items-center rounded-md bg-ok-suave text-ok">
            <IconCircleCheck className="size-5" stroke={1.75} aria-hidden="true" />
          </span>
          <div role="status">
            <h1 ref={tituloRef} tabIndex={-1} className="text-titulo-lg font-forte outline-none">
              {textos.sucesso}
            </h1>
            <p className="mt-2 text-corpo text-tinta-secundaria">{textos.sucessoTexto}</p>
          </div>
          <Link to={contexto.rotaLogin} state={{ email }} className={cn(buttonVariants({ size: 'lg' }), 'h-11 w-full')}>
            Ir para o login
          </Link>
        </div>
      </LayoutLogin>
    )
  }

  // ---------------------------------------------------------- formulário
  const erroConfirmacao = confirmacao.length > 0 && confirmacao !== senha ? 'As senhas não são iguais. Digite a mesma senha nos dois campos.' : undefined
  const erroGeral = salvar.error != null && !errosDoServidor.length && !linkRecusado(salvar.error) ? mensagemDeErro(salvar.error) : null

  return (
    <LayoutLogin publico={publico}>
      <form className="flex flex-col gap-5" onSubmit={enviar} noValidate aria-busy={salvar.isPending}>
        <header>
          <h1 className="text-titulo-lg font-forte">{textos.titulo}</h1>
          <p className="mt-2 text-corpo text-tinta-secundaria">
            Para a conta <strong className="font-medio text-tinta">{email}</strong>.
          </p>
        </header>

        {erroGeral && (
          <Alert variant="destructive" titulo="Não deu para salvar a senha">
            {erroGeral}
          </Alert>
        )}

        {/* O gerenciador de senhas precisa saber DE QUAL conta é a senha
            nova; sem um campo de usuário no formulário ele a salva sem nome. */}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idBase}-senha`} className="text-corpo">
            Senha nova
          </Label>
          <CampoSenha
            id={`${idBase}-senha`}
            autoComplete="new-password"
            autoFocus
            value={senha}
            onChange={(e) => {
              setSenha(e.target.value)
              if (salvar.error) salvar.reset()
            }}
            aria-invalid={errosDoServidor.length > 0 || (tentouEnviar && !pronta) || undefined}
            aria-describedby={[errosDoServidor.length ? `${idBase}-servidor` : null, `${idBase}-regras`].filter(Boolean).join(' ')}
          />
          {errosDoServidor.length > 0 && (
            <ul id={`${idBase}-servidor`} role="alert" className="flex flex-col gap-1 text-pequeno text-perigo">
              {errosDoServidor.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idBase}-confirma`} className="text-corpo">
            Confirmar senha nova
          </Label>
          <CampoSenha
            id={`${idBase}-confirma`}
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            aria-invalid={Boolean(erroConfirmacao) || undefined}
            aria-describedby={erroConfirmacao ? `${idBase}-confirma-erro` : undefined}
          />
          <ErroCampo id={`${idBase}-confirma-erro`}>{erroConfirmacao}</ErroCampo>
        </div>

        <ListaDeRegras id={`${idBase}-regras`} regras={regras} />

        {tentouEnviar && !pronta && (
          <p role="alert" className="text-pequeno text-perigo">
            Falta cumprir os requisitos marcados como pendentes.
          </p>
        )}

        <Button type="submit" size="lg" className="h-11 w-full" disabled={salvar.isPending}>
          {salvar.isPending ? textos.salvando : textos.botao}
        </Button>

        <Link to={contexto.rotaLogin} className="login-link w-fit text-corpo">
          Voltar para o login
        </Link>
      </form>
    </LayoutLogin>
  )
}
