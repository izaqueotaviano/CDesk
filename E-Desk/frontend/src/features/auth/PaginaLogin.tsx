import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useConfirmar2fa, useReenviar2fa } from '@/api/mutations/use2fa'
import { useLogin } from '@/api/mutations/useLogin'
import { ApiError } from '@/api/client'
import { Botao } from '@/ui/Botao'
import { Campo } from '@/ui/Campo'

const esquemaCredenciais = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Obrigatório'),
})
type Credenciais = z.infer<typeof esquemaCredenciais>

const esquemaCodigo = z.object({
  code: z.string().min(1, 'Obrigatório'),
})
type Codigo = z.infer<typeof esquemaCodigo>

/**
 * Fluxo em dois passos, exatamente como documentado (docs/10-frontend-novo.md):
 * senha certa NÃO cria sessão autenticada sozinha — só depois do código de
 * 2FA o cookie `csrftoken` aparece e a sessão vira de verdade.
 */
export function PaginaLogin() {
  const [passo, setPasso] = useState<'credenciais' | 'codigo'>('credenciais')
  const [email, setEmail] = useState('')
  const navigate = useNavigate()

  const login = useLogin()
  const confirmar2fa = useConfirmar2fa()
  const reenviar2fa = useReenviar2fa()

  const formCredenciais = useForm<Credenciais>({ resolver: zodResolver(esquemaCredenciais) })
  const formCodigo = useForm<Codigo>({ resolver: zodResolver(esquemaCodigo) })

  async function enviarCredenciais(dados: Credenciais) {
    await login.mutateAsync(dados)
    setEmail(dados.email)
    setPasso('codigo')
  }

  async function enviarCodigo(dados: Codigo) {
    await confirmar2fa.mutateAsync(dados)
    navigate('/inicio', { replace: true })
  }

  const erro = login.error ?? confirmar2fa.error
  const mensagemErro =
    erro instanceof ApiError ? (erro.detail ?? 'Não foi possível continuar.') : undefined

  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <div className="w-full max-w-sm rounded-lg border border-divisoria bg-superficie p-8 shadow-elevacao-1">
        <h1 className="mb-6 text-titulo font-forte text-tinta">resolv</h1>

        {passo === 'credenciais' ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={formCredenciais.handleSubmit(enviarCredenciais)}
          >
            <Campo
              rotulo="E-mail"
              type="email"
              autoComplete="username"
              erro={formCredenciais.formState.errors.email?.message}
              {...formCredenciais.register('email')}
            />
            <Campo
              rotulo="Senha"
              type="password"
              autoComplete="current-password"
              erro={formCredenciais.formState.errors.password?.message}
              {...formCredenciais.register('password')}
            />
            {mensagemErro ? <p className="text-pequeno text-perigo">{mensagemErro}</p> : null}
            <Botao type="submit" disabled={login.isPending}>
              {login.isPending ? 'Entrando…' : 'Entrar'}
            </Botao>
          </form>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={formCodigo.handleSubmit(enviarCodigo)}>
            <p className="text-pequeno text-tinta-secundaria">
              Enviamos um código para <strong>{email}</strong>.
            </p>
            <Campo
              rotulo="Código"
              inputMode="numeric"
              autoComplete="one-time-code"
              erro={formCodigo.formState.errors.code?.message}
              {...formCodigo.register('code')}
            />
            {mensagemErro ? <p className="text-pequeno text-perigo">{mensagemErro}</p> : null}
            <Botao type="submit" disabled={confirmar2fa.isPending}>
              {confirmar2fa.isPending ? 'Confirmando…' : 'Confirmar'}
            </Botao>
            <Botao
              type="button"
              variante="fantasma"
              disabled={reenviar2fa.isPending}
              onClick={() => reenviar2fa.mutate()}
            >
              Reenviar código
            </Botao>
          </form>
        )}
      </div>
    </div>
  )
}
