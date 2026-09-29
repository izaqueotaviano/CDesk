import { useEffect, useId, useState } from 'react'
import QRCode from 'qrcode'
import { IconDeviceMobile, IconMail, IconShieldCheck, IconShieldOff } from '@tabler/icons-react'
import { ApiError } from '@/api/client'
import {
  useConfirmar2fa,
  useDesativar2fa,
  useIniciar2fa,
  usePedirCodigoDesativar2fa,
  useStatus2fa,
  type Setup2fa,
} from '../api/conta'
import { cn } from '../lib/cn'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Ajuda, ErroCampo, Input, Label } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Switch } from '../ui/switch'
import { toast } from '../ui/toaster'
import { Secao } from './Secao'

type Metodo = 'email' | 'totp'

function mensagem(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.detail ?? padrao) : padrao
}

/** O QR do `otpauth://` como SVG — gerado em memória, sem sair da máquina. */
function QrDoAutenticador({ uri }: { uri: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    QRCode.toString(uri, { type: 'svg', margin: 1, width: 176 })
      .then((s) => vivo && setSvg(s))
      .catch(() => vivo && setSvg(null))
    return () => {
      vivo = false
    }
  }, [uri])
  if (!svg) return <Skeleton className="size-44 rounded-lg" />
  return (
    <div
      role="img"
      aria-label="QR code para o aplicativo autenticador"
      className="size-44 overflow-hidden rounded-lg  bg-white p-1 [&_svg]:size-full"
      // SVG gerado pela biblioteca a partir da URI — não é conteúdo de terceiros
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function CampoCodigo({
  id,
  valor,
  onChange,
  erro,
  rotulo = 'Código',
}: {
  id: string
  valor: string
  onChange: (v: string) => void
  erro: string | null
  rotulo?: string
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-xs">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={valor}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        aria-invalid={Boolean(erro) || undefined}
      />
      <ErroCampo>{erro}</ErroCampo>
    </div>
  )
}

const OPCOES: { valor: Metodo; rotulo: string; descricao: string; icone: typeof IconMail }[] = [
  { valor: 'email', rotulo: 'Por e-mail', descricao: 'Um código de 6 dígitos chega no seu e-mail a cada login. Não precisa instalar nada.', icone: IconMail },
  {
    valor: 'totp',
    rotulo: 'Aplicativo autenticador',
    descricao: 'Google Authenticator, Microsoft Authenticator, Authy, 1Password… Funciona sem internet e sem depender do e-mail chegar.',
    icone: IconDeviceMobile,
  },
]

/**
 * Verificação em duas etapas, opcional por conta: a pessoa liga (por e-mail
 * ou pelo aplicativo autenticador), troca de método ou desliga. Nada muda
 * até um código válido confirmar — ligar prova que o código chega; desligar
 * prova que quem pede tem o fator. Quando o admin exige de todos, o
 * interruptor fica travado em "ligada" e resta escolher o método.
 * A mesma seção serve o portal do cliente e "Minha conta" da equipe.
 */
export function SecaoSeguranca() {
  const status = useStatus2fa()
  const iniciar = useIniciar2fa()
  const confirmar = useConfirmar2fa()
  const pedirCodigo = usePedirCodigoDesativar2fa()
  const desativar = useDesativar2fa()
  const idBase = useId()

  const [ativando, setAtivando] = useState<{ metodo: Metodo; setup: Setup2fa | null } | null>(null)
  const [desligando, setDesligando] = useState<{ codigoEnviado: boolean } | null>(null)
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const descricao = 'Uma segunda confirmação no login, além da senha. Escolha se quer usá-la e como receber o código.'

  function limpar() {
    setAtivando(null)
    setDesligando(null)
    setCodigo('')
    setErro(null)
  }

  function iniciarAtivacao(metodo: Metodo) {
    setErro(null)
    setCodigo('')
    setDesligando(null)
    setAtivando({ metodo, setup: null })
    iniciar.mutate(metodo, {
      onSuccess: (dados) => setAtivando({ metodo, setup: dados }),
      onError: (e) => {
        setAtivando(null)
        toast.error(mensagem(e, 'Não foi possível iniciar a ativação.'))
      },
    })
  }

  function enviarConfirmacao() {
    if (!ativando) return
    const metodo = ativando.metodo
    confirmar.mutate(codigo.trim(), {
      onSuccess: () => {
        limpar()
        toast.success(metodo === 'totp' ? 'Aplicativo autenticador ativado.' : 'Verificação por e-mail ativada.')
      },
      onError: (e) => setErro(mensagem(e, 'Código inválido ou expirado.')),
    })
  }

  function iniciarDesligamento(metodoAtual: Metodo) {
    setErro(null)
    setCodigo('')
    setAtivando(null)
    if (metodoAtual === 'email') {
      setDesligando({ codigoEnviado: false })
      pedirCodigo.mutate(undefined, {
        onSuccess: () => setDesligando({ codigoEnviado: true }),
        onError: (e) => {
          setDesligando(null)
          toast.error(mensagem(e, 'Não foi possível enviar o código.'))
        },
      })
    } else {
      setDesligando({ codigoEnviado: true })
    }
  }

  function enviarDesligamento() {
    desativar.mutate(codigo.trim(), {
      onSuccess: () => {
        limpar()
        toast.success('Verificação em duas etapas desligada. Você entra só com a senha.')
      },
      onError: (e) => setErro(mensagem(e, 'Código inválido ou expirado.')),
    })
  }

  if (status.isLoading) {
    return (
      <Secao id="seguranca" icone={IconShieldCheck} titulo="Verificação em duas etapas" descricao={descricao}>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-10 w-full" />
      </Secao>
    )
  }
  if (status.isError || !status.data) {
    return (
      <Secao id="seguranca" icone={IconShieldCheck} titulo="Verificação em duas etapas" descricao={descricao}>
        <Alert
          variant="destructive"
          titulo="Não foi possível carregar a verificação em duas etapas"
          acao={
            <Button size="sm" variant="secondary" onClick={() => status.refetch()}>
              Tentar de novo
            </Button>
          }
        >
          {status.error instanceof ApiError ? `Erro ${status.error.status}.` : 'Verifique sua conexão.'}
        </Alert>
      </Secao>
    )
  }

  const { method, required } = status.data
  const metodoAtual: Metodo | '' = method === 'totp' || method === 'email' ? method : ''
  const ligada = metodoAtual !== '' || required
  const idCodigo = `${idBase}-codigo`
  const ocupado = iniciar.isPending || confirmar.isPending || desativar.isPending || pedirCodigo.isPending

  const resumo = !ligada
    ? { titulo: 'Desligada', texto: 'Você entra só com a senha.', tom: 'neutro' as const, Icone: IconShieldOff }
    : metodoAtual === 'totp'
      ? { titulo: 'Ligada', texto: 'O código do login vem do aplicativo autenticador.', tom: 'ok' as const, Icone: IconShieldCheck }
      : metodoAtual === 'email'
        ? { titulo: 'Ligada', texto: 'O código do login chega por e-mail.', tom: 'ok' as const, Icone: IconShieldCheck }
        : { titulo: 'Exigida pela empresa', texto: 'O código do login chega por e-mail. Se preferir, use o aplicativo autenticador.', tom: 'acento' as const, Icone: IconShieldCheck }

  return (
    <Secao
      id="seguranca"
      icone={IconShieldCheck}
      titulo="Verificação em duas etapas"
      descricao={descricao}
      rodape={
        <span className="text-legenda text-tinta-terciaria">
          Perdeu o aplicativo ou o acesso ao e-mail? Fale com o suporte: um administrador libera sua conta.
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-3 rounded-lg  bg-navegacao/60 px-4 py-3">
        <resumo.Icone className={cn('size-5', ligada ? 'text-ok' : 'text-tinta-secundaria')} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-pequeno font-medio text-tinta">{resumo.titulo}</p>
          <p className="text-legenda text-tinta-secundaria">{resumo.texto}</p>
        </div>
        <Badge variant={resumo.tom} ponto>
          {metodoAtual === 'totp' ? 'Aplicativo' : ligada ? 'E-mail' : 'Só senha'}
        </Badge>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={`${idBase}-ligar`} className="block text-pequeno font-medio text-tinta">
            Verificação em duas etapas
          </label>
          <p id={`${idBase}-ligar-desc`} className="text-legenda text-tinta-secundaria">
            {required && metodoAtual === ''
              ? 'Exigida pela empresa — não pode ser desligada por aqui.'
              : ligada
                ? 'Desligar exige um código do método atual.'
                : 'Recomendada: protege sua conta mesmo que a senha vaze.'}
          </p>
        </div>
        <Switch
          id={`${idBase}-ligar`}
          checked={ligada ? desligando === null : ativando !== null}
          aria-describedby={`${idBase}-ligar-desc`}
          disabled={ocupado || (required && metodoAtual === '')}
          onCheckedChange={(v) => {
            if (ligada) {
              if (v) limpar()
              else iniciarDesligamento(metodoAtual as Metodo)
            } else if (v) {
              setAtivando({ metodo: 'email', setup: null })
            } else {
              limpar()
            }
          }}
        />
      </div>

      {ligada && !ativando && !desligando && (
        <div className="flex flex-wrap items-center justify-between gap-3  pt-4">
          <p className="text-pequeno text-tinta-secundaria">
            Método atual: <strong className="text-tinta">{metodoAtual === 'totp' ? 'aplicativo autenticador' : 'e-mail'}</strong>
          </p>
          <Button variant="secondary" size="sm" onClick={() => iniciarAtivacao(metodoAtual === 'totp' ? 'email' : 'totp')} disabled={ocupado}>
            {metodoAtual === 'totp' ? <IconMail /> : <IconDeviceMobile />}
            {metodoAtual === 'totp' ? 'Trocar para e-mail' : 'Usar o aplicativo autenticador'}
          </Button>
        </div>
      )}

      {ativando && !ativando.setup && (
        <div className="flex flex-col gap-4 rounded-xl border border-acento/30 bg-acento-suave/40 p-4">
          <p className="text-pequeno font-medio text-tinta">Como você quer receber o código?</p>
          <div role="radiogroup" aria-label="Método da verificação" className="grid gap-3 sm:grid-cols-2">
            {OPCOES.map((o) => {
              const ativo = ativando.metodo === o.valor
              return (
                <button
                  key={o.valor}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => setAtivando({ metodo: o.valor, setup: null })}
                  className={cn(
                    'flex gap-3 rounded-xl border bg-superficie p-3 text-left transition-[border-color] hover:border-borda-controle',
                    ativo ? 'border-acento ring-1 ring-acento' : '',
                  )}
                >
                  <o.icone className={cn('mt-0.5 size-4 shrink-0', ativo ? 'text-acento' : 'text-tinta-secundaria')} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className={cn('block text-pequeno font-medio', ativo ? 'text-acento' : 'text-tinta')}>{o.rotulo}</span>
                    <span className="block text-legenda text-tinta-secundaria">{o.descricao}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => iniciarAtivacao(ativando.metodo)} disabled={iniciar.isPending}>
              {iniciar.isPending ? 'Preparando…' : 'Continuar'}
            </Button>
            <Button variant="ghost" onClick={limpar}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {ativando?.setup && (
        <div className="flex flex-col gap-4 rounded-xl border border-acento/30 bg-acento-suave/40 p-4">
          {ativando.metodo === 'totp' ? (
            <div className="flex flex-col gap-4 sm:flex-row">
              {ativando.setup.otpauth_uri && <QrDoAutenticador uri={ativando.setup.otpauth_uri} />}
              <ol className="flex flex-1 list-decimal flex-col gap-1.5 pl-5 text-pequeno text-tinta">
                <li>Abra o aplicativo autenticador no celular.</li>
                <li>
                  Leia o QR code ou digite a chave:{' '}
                  <code className="fonte-mono select-all break-all rounded bg-superficie px-1.5 py-0.5 text-legenda">{ativando.setup.secret}</code>
                </li>
                <li>Digite abaixo o código de 6 dígitos que ele mostrar.</li>
              </ol>
            </div>
          ) : (
            <p className="text-pequeno text-tinta">
              Enviamos um código de 6 dígitos para o seu e-mail. Digite-o abaixo para confirmar que ele chega.
            </p>
          )}
          <CampoCodigo id={idCodigo} valor={codigo} onChange={(v) => { setCodigo(v); setErro(null) }} erro={erro} rotulo={ativando.metodo === 'totp' ? 'Código do aplicativo' : 'Código recebido por e-mail'} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={enviarConfirmacao} disabled={codigo.length !== 6 || confirmar.isPending}>
              {confirmar.isPending ? 'Confirmando…' : 'Confirmar e ativar'}
            </Button>
            <Button variant="ghost" onClick={limpar}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {desligando && (
        <div className="flex flex-col gap-4 rounded-xl border border-alerta/40 bg-alerta-suave/30 p-4">
          <p className="text-pequeno text-tinta">
            {metodoAtual === 'totp'
              ? 'Para desligar, confirme com um código do aplicativo autenticador.'
              : desligando.codigoEnviado
                ? 'Enviamos um código para o seu e-mail. Digite-o para confirmar que é você.'
                : 'Enviando um código para o seu e-mail…'}
          </p>
          <CampoCodigo id={idCodigo} valor={codigo} onChange={(v) => { setCodigo(v); setErro(null) }} erro={erro} rotulo={metodoAtual === 'totp' ? 'Código do aplicativo' : 'Código recebido por e-mail'} />
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={enviarDesligamento} disabled={codigo.length !== 6 || desativar.isPending || !desligando.codigoEnviado}>
              {desativar.isPending ? 'Desligando…' : 'Desligar verificação'}
            </Button>
            <Button variant="ghost" onClick={limpar}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {!ativando && !desligando && ligada && metodoAtual === 'totp' && (
        <Ajuda>Ao trocar de celular, troque para e-mail aqui antes, ou fale com o suporte.</Ajuda>
      )}
    </Secao>
  )
}
