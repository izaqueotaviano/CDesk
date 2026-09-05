import { useEffect, useId, useState } from 'react'
import QRCode from 'qrcode'
import { ShieldCheck, Smartphone } from 'lucide-react'
import { ApiError } from '@/api/client'
import { useConfirmar2fa, useDesativar2fa, useIniciar2fa, useStatus2fa, type Setup2fa } from '../api/conta'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Ajuda, ErroCampo, Input, Label } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Switch } from '../ui/switch'
import { toast } from '../ui/toaster'
import { Secao } from './Secao'

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
      className="size-44 overflow-hidden rounded-lg border border-divisoria bg-white p-1 [&_svg]:size-full"
      // SVG gerado pela biblioteca a partir da URI — não é conteúdo de terceiros
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/**
 * Verificação em duas etapas. Ela é exigida em TODO login (decisão de
 * segurança do produto, não se desliga): o que a pessoa escolhe aqui é se o
 * código vem por e-mail — o padrão, sem configurar nada — ou pelo
 * aplicativo autenticador. Ligar o aplicativo só vale depois de um código
 * dele confirmar a configuração; desligar exige um código do aplicativo.
 */
export function SecaoSeguranca() {
  const status = useStatus2fa()
  const iniciar = useIniciar2fa()
  const confirmar = useConfirmar2fa()
  const desativar = useDesativar2fa()
  const idBase = useId()

  const [setup, setSetup] = useState<Setup2fa | null>(null)
  const [desativando, setDesativando] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const porApp = status.data?.method === 'totp'
  const descricao = 'Sempre exigida no login. Escolha como quer receber o código: por e-mail ou pelo aplicativo autenticador.'

  function limpar() {
    setSetup(null)
    setDesativando(false)
    setCodigo('')
    setErro(null)
  }

  function alternar(ligar: boolean) {
    setErro(null)
    setCodigo('')
    if (ligar) {
      setDesativando(false)
      iniciar.mutate('totp', {
        onSuccess: (dados) => setSetup(dados),
        onError: (e) => toast.error(mensagem(e, 'Não foi possível iniciar a ativação.')),
      })
    } else {
      setSetup(null)
      setDesativando(true)
    }
  }

  function enviarConfirmacao() {
    confirmar.mutate(codigo.trim(), {
      onSuccess: () => {
        limpar()
        toast.success('Aplicativo autenticador ativado. A partir do próximo login, o código vem dele.')
      },
      onError: (e) => setErro(mensagem(e, 'Código inválido ou expirado.')),
    })
  }

  function enviarDesativacao() {
    desativar.mutate(codigo.trim(), {
      onSuccess: () => {
        limpar()
        toast.success('Aplicativo desligado. O código volta a chegar por e-mail.')
      },
      onError: (e) => setErro(mensagem(e, 'Código inválido ou expirado.')),
    })
  }

  if (status.isLoading) {
    return (
      <Secao id="seguranca" icone={ShieldCheck} titulo="Verificação em duas etapas" descricao={descricao}>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-10 w-full" />
      </Secao>
    )
  }
  if (status.isError || !status.data) {
    return (
      <Secao id="seguranca" icone={ShieldCheck} titulo="Verificação em duas etapas" descricao={descricao}>
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

  const idCodigo = `${idBase}-codigo`
  const emFluxo = setup !== null || desativando

  return (
    <Secao
      id="seguranca"
      icone={ShieldCheck}
      titulo="Verificação em duas etapas"
      descricao={descricao}
      rodape={
        <span className="text-legenda text-tinta-terciaria">
          Perdeu o aplicativo? Fale com o suporte: um administrador volta seu acesso para o código por e-mail.
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-divisoria bg-navegacao/60 px-4 py-3">
        <ShieldCheck className="size-5 text-ok" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-pequeno font-medio text-tinta">Ativa em todos os logins</p>
          <p className="text-legenda text-tinta-secundaria">
            {porApp ? 'Hoje o código vem do aplicativo autenticador.' : 'Hoje o código chega por e-mail.'}
          </p>
        </div>
        <Badge variant={porApp ? 'ok' : 'acento'} ponto>
          {porApp ? 'Aplicativo' : 'E-mail'}
        </Badge>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={`${idBase}-app`} className="flex items-center gap-2 text-pequeno font-medio text-tinta">
            <Smartphone className="size-4 text-tinta-secundaria" aria-hidden="true" />
            Usar aplicativo autenticador
          </label>
          <p id={`${idBase}-app-desc`} className="text-legenda text-tinta-secundaria">
            Google Authenticator, Microsoft Authenticator, Authy, 1Password… O código funciona sem internet e sem depender do e-mail chegar.
          </p>
        </div>
        <Switch
          id={`${idBase}-app`}
          checked={porApp ? !desativando : setup !== null}
          aria-describedby={`${idBase}-app-desc`}
          disabled={iniciar.isPending || confirmar.isPending || desativar.isPending}
          onCheckedChange={(v) => {
            if (porApp) {
              if (v) limpar()
              else alternar(false)
            } else if (v) {
              alternar(true)
            } else {
              limpar()
            }
          }}
        />
      </div>

      {setup && (
        <div className="flex flex-col gap-4 rounded-xl border border-acento/30 bg-acento-suave/40 p-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            {setup.otpauth_uri && <QrDoAutenticador uri={setup.otpauth_uri} />}
            <ol className="flex flex-1 list-decimal flex-col gap-1.5 pl-5 text-pequeno text-tinta">
              <li>Abra o aplicativo autenticador no celular.</li>
              <li>
                Leia o QR code ou digite a chave:{' '}
                <code className="fonte-mono select-all break-all rounded bg-superficie px-1.5 py-0.5 text-legenda">{setup.secret}</code>
              </li>
              <li>Digite abaixo o código de 6 dígitos que ele mostrar.</li>
            </ol>
          </div>
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <Label htmlFor={idCodigo}>Código do aplicativo</Label>
            <Input
              id={idCodigo}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={codigo}
              onChange={(e) => {
                setCodigo(e.target.value.replace(/\D/g, ''))
                setErro(null)
              }}
              aria-invalid={Boolean(erro) || undefined}
            />
            <ErroCampo>{erro}</ErroCampo>
          </div>
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

      {desativando && (
        <div className="flex flex-col gap-4 rounded-xl border border-alerta/40 bg-alerta-suave/30 p-4">
          <p className="text-pequeno text-tinta">
            Para desligar o aplicativo, confirme com um código dele. Depois disso o código do login volta a chegar por e-mail.
          </p>
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <Label htmlFor={idCodigo}>Código do aplicativo</Label>
            <Input
              id={idCodigo}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={codigo}
              onChange={(e) => {
                setCodigo(e.target.value.replace(/\D/g, ''))
                setErro(null)
              }}
              aria-invalid={Boolean(erro) || undefined}
            />
            <ErroCampo>{erro}</ErroCampo>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={enviarDesativacao} disabled={codigo.length !== 6 || desativar.isPending}>
              {desativar.isPending ? 'Desligando…' : 'Desligar aplicativo'}
            </Button>
            <Button variant="ghost" onClick={limpar}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {!emFluxo && <Ajuda>Ao trocar de celular, desligue o aplicativo aqui antes, ou fale com o suporte.</Ajuda>}
    </Secao>
  )
}
