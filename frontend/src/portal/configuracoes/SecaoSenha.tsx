import { useId, useState, type FormEvent } from 'react'
import { IconCheck, IconEye, IconEyeOff, IconKey } from '@tabler/icons-react'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { useTrocarSenha } from '../api/conta'
import { cn } from '../lib/cn'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Ajuda, ErroCampo, Input, Label } from '../ui/input'
import { toast } from '../ui/toaster'
import { Secao } from './Secao'

const MINIMO = 12

/** As mesmas regras do servidor (AUTH_PASSWORD_VALIDATORS), conferidas ao
 *  digitar — a pessoa vê o que falta antes de enviar, não depois. */
function regras(senha: string, confirmacao: string, email: string, nome: string) {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]|_/].filter((r) => r.test(senha)).length
  const baixa = senha.toLowerCase()
  const usuario = email.split('@')[0]?.toLowerCase() ?? ''
  const partesNome = nome.toLowerCase().split(/\s+/).filter((p) => p.length >= 4)
  const parecida = (usuario.length >= 4 && baixa.includes(usuario)) || partesNome.some((p) => baixa.includes(p))
  return [
    { id: 'tamanho', ok: senha.length >= MINIMO, texto: `Pelo menos ${MINIMO} caracteres` },
    { id: 'variedade', ok: classes >= 3, texto: 'Três tipos de caractere: minúsculas, maiúsculas, números ou símbolos' },
    { id: 'pessoal', ok: senha.length > 0 && !parecida, texto: 'Não parecida com seu nome ou e-mail' },
    { id: 'confirma', ok: senha.length > 0 && senha === confirmacao, texto: 'Confirmação igual à nova senha' },
  ]
}

function CampoSenha({
  id,
  rotulo,
  valor,
  onChange,
  autoComplete,
  erro,
  descritoPor,
}: {
  id: string
  rotulo: string
  valor: string
  onChange: (v: string) => void
  autoComplete: string
  erro?: string
  descritoPor?: string
}) {
  const [visivel, setVisivel] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visivel ? 'text' : 'password'}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="pr-11"
          aria-invalid={Boolean(erro) || undefined}
          aria-describedby={[erro ? `${id}-erro` : null, descritoPor].filter(Boolean).join(' ') || undefined}
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-tinta-secundaria hover:bg-navegacao hover:text-tinta"
          aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visivel}
        >
          {visivel ? <IconEyeOff className="size-4" /> : <IconEye className="size-4" />}
        </button>
      </div>
      <ErroCampo id={`${id}-erro`}>{erro}</ErroCampo>
    </div>
  )
}

/**
 * Trocar a senha provando a identidade com a atual. Quem não tem a atual
 * usa "Esqueci minha senha" na tela de entrada (o link vai por e-mail). As
 * outras sessões continuam abertas de propósito — a tela avisa.
 */
export function SecaoSenha() {
  const { data: me } = useMe()
  const trocar = useTrocarSenha()
  const idBase = useId()
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erros, setErros] = useState<Record<string, string[]>>({})
  const [trocada, setTrocada] = useState(false)

  const lista = regras(nova, confirmacao, me?.email ?? '', me?.full_name ?? '')
  const pronta = atual.length > 0 && lista.every((r) => r.ok)

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (!pronta) return
    setErros({})
    setTrocada(false)
    trocar.mutate(
      { current_password: atual, new_password: nova },
      {
        onSuccess: () => {
          setAtual('')
          setNova('')
          setConfirmacao('')
          setTrocada(true)
          toast.success('Senha trocada.')
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 429) {
            toast.error('Muitas tentativas. Aguarde um pouco e tente de novo.')
            return
          }
          if (err instanceof ApiError && err.fieldErrors) {
            setErros(err.fieldErrors)
            return
          }
          toast.error(err instanceof ApiError ? (err.detail ?? 'Não foi possível trocar a senha.') : 'Não foi possível trocar a senha.')
        },
      },
    )
  }

  return (
    <Secao
      id="senha"
      icone={IconKey}
      titulo="Alterar senha"
      descricao={'Informe a senha atual para confirmar que é você. Não lembra dela? Saia e use "Esqueci minha senha" na tela de entrada.'}
    >
      <form onSubmit={enviar} className="flex flex-col gap-5" noValidate>
        {trocada && (
          <Alert variant="success" titulo="Senha trocada">
            Suas outras sessões continuam abertas. Se trocou por suspeita de acesso indevido, avise o suporte para encerrá-las.
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 sm:max-w-sm">
            <CampoSenha id={`${idBase}-atual`} rotulo="Senha atual" valor={atual} onChange={setAtual} autoComplete="current-password" erro={erros.current_password?.[0]} />
          </div>
          <CampoSenha
            id={`${idBase}-nova`}
            rotulo="Nova senha"
            valor={nova}
            onChange={(v) => {
              setNova(v)
              if (erros.new_password) setErros((e) => ({ ...e, new_password: [] }))
            }}
            autoComplete="new-password"
            erro={erros.new_password?.[0]}
            descritoPor={`${idBase}-regras`}
          />
          <CampoSenha
            id={`${idBase}-confirma`}
            rotulo="Confirmar nova senha"
            valor={confirmacao}
            onChange={setConfirmacao}
            autoComplete="new-password"
            erro={confirmacao.length > 0 && confirmacao !== nova ? 'As senhas não coincidem.' : undefined}
          />
        </div>
        {erros.new_password && erros.new_password.length > 1 && (
          <ul className="list-disc pl-5 text-legenda text-perigo" role="alert">
            {erros.new_password.slice(1).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <ul id={`${idBase}-regras`} className="grid gap-1.5 sm:grid-cols-2" aria-label="Requisitos da senha">
          {lista.map((r) => (
            <li key={r.id} className={cn('flex items-center gap-2 text-legenda', r.ok ? 'text-ok' : 'text-tinta-secundaria')}>
              <span className={cn('grid size-4 shrink-0 place-items-center rounded-total border', r.ok ? 'border-ok bg-ok text-white' : '')} aria-hidden="true">
                {r.ok && <IconCheck className="size-3" />}
              </span>
              {r.texto}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Ajuda>Dica: uma frase longa com espaços e números é mais forte que uma senha curta cheia de símbolos.</Ajuda>
          <Button type="submit" disabled={!pronta || trocar.isPending}>
            {trocar.isPending ? 'Trocando…' : 'Trocar senha'}
          </Button>
        </div>
      </form>
    </Secao>
  )
}
