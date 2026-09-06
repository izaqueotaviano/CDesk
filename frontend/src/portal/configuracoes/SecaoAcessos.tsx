import { Ban, KeyRound, LogIn, LogOut, Monitor, ShieldCheck, ShieldOff, XCircle } from 'lucide-react'
import type { EventoDeAcesso, SessaoViva } from '../api/conta'
import { useEncerrarSessao, useMeuHistoricoAcesso } from '../api/conta'
import { ApiError } from '@/api/client'
import { dataHora, relativo, useAgora } from '../lib/formato'
import { cn } from '../lib/cn'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { Secao } from './Secao'

const ICONE_EVENTO: Record<string, typeof LogIn> = {
  login: LogIn,
  login_failed: XCircle,
  password_changed: KeyRound,
  twofa_enabled: ShieldCheck,
  twofa_disabled: ShieldOff,
}

function LinhaSessao({
  sessao,
  agoraMs,
  onEncerrar,
  encerrando,
}: {
  sessao: SessaoViva
  agoraMs: number
  onEncerrar: () => void
  encerrando: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-divisoria bg-navegacao/60 px-4 py-3">
      <Monitor className="size-5 shrink-0 text-tinta-secundaria" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-pequeno font-medio text-tinta">
          {sessao.browser}
          {sessao.current && (
            <Badge variant="ok" ponto>
              Este dispositivo
            </Badge>
          )}
        </p>
        <p className="text-legenda text-tinta-secundaria">
          {sessao.ip || 'IP desconhecido'} · desde {relativo(sessao.started_at, agoraMs)}
        </p>
      </div>
      {!sessao.current && (
        <Button variant="secondary" size="sm" onClick={onEncerrar} disabled={encerrando}>
          <LogOut />
          {encerrando ? 'Encerrando…' : 'Encerrar'}
        </Button>
      )}
    </div>
  )
}

function LinhaEvento({ evento }: { evento: EventoDeAcesso }) {
  const Icone = ICONE_EVENTO[evento.kind] ?? Ban
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icone
        className={cn('mt-0.5 size-4 shrink-0', evento.success ? 'text-tinta-secundaria' : 'text-perigo')}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className={cn('text-pequeno font-medio', evento.success ? 'text-tinta' : 'text-perigo')}>
          {evento.kind_label}
        </p>
        <p className="text-legenda text-tinta-secundaria">
          {evento.browser} · {evento.ip || 'IP desconhecido'} · {dataHora(evento.created_at)}
        </p>
      </div>
    </li>
  )
}

/**
 * Sessões ativas (com botão de encerrar) e o histórico de acesso da própria
 * conta — login, login que falhou, troca de senha, 2FA ligada/desligada.
 * Mesma seção serve o portal do cliente e "Minha conta" da equipe: os
 * endpoints (`/me/sessions/`, `/me/access-history/`) já são self-service,
 * sem depender de nenhuma permissão de admin.
 */
export function SecaoAcessos() {
  const historico = useMeuHistoricoAcesso()
  const encerrar = useEncerrarSessao()
  const agoraMs = useAgora()
  const descricao = 'Onde sua conta está logada agora, e o que aconteceu nela recentemente.'

  function encerrarSessao(sessao: SessaoViva) {
    if (!window.confirm(`Encerrar a sessão em "${sessao.browser}"? Essa pessoa (ou você, nesse dispositivo) precisará entrar de novo.`)) {
      return
    }
    encerrar.mutate(sessao.key, {
      onError: (e) =>
        toast.error(e instanceof ApiError ? (e.detail ?? 'Não foi possível encerrar a sessão.') : 'Não foi possível encerrar a sessão.'),
    })
  }

  if (historico.isLoading) {
    return (
      <Secao id="acessos" icone={Monitor} titulo="Sessões e acesso" descricao={descricao}>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </Secao>
    )
  }

  if (historico.isError || !historico.data) {
    return (
      <Secao id="acessos" icone={Monitor} titulo="Sessões e acesso" descricao={descricao}>
        <Alert
          variant="destructive"
          titulo="Não foi possível carregar as sessões"
          acao={
            <Button size="sm" variant="secondary" onClick={() => historico.refetch()}>
              Tentar de novo
            </Button>
          }
        >
          {historico.error instanceof ApiError ? `Erro ${historico.error.status}.` : 'Verifique sua conexão.'}
        </Alert>
      </Secao>
    )
  }

  const { sessions, events, session_limit } = historico.data

  return (
    <Secao id="acessos" icone={Monitor} titulo="Sessões e acesso" descricao={descricao}>
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-pequeno font-medio text-tinta">Sessões ativas</h3>
          <span className="text-legenda text-tinta-secundaria">
            {sessions.length} de {session_limit} no máximo
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <LinhaSessao
              key={s.key}
              sessao={s}
              agoraMs={agoraMs}
              onEncerrar={() => encerrarSessao(s)}
              encerrando={encerrar.isPending && encerrar.variables === s.key}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-divisoria pt-4">
        <h3 className="mb-1 text-pequeno font-medio text-tinta">Atividade recente</h3>
        {events.length === 0 ? (
          <p className="text-legenda text-tinta-secundaria">Nada por aqui ainda.</p>
        ) : (
          <ul className="divide-y divide-divisoria">
            {events.map((e) => (
              <LinhaEvento key={`${e.kind}-${e.created_at}`} evento={e} />
            ))}
          </ul>
        )}
      </div>
    </Secao>
  )
}
