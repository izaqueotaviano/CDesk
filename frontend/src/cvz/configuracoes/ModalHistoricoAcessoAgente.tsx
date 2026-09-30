import { Button, ErrorState, Modal, Tag } from '@/cvz/components'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import { useHistoricoAcessoAgente, useRevogarSessaoAgente, type AgenteCfg } from './dados'

function mensagemDeErro(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.detail ?? padrao) : padrao
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR')
}

/**
 * "Ver histórico de acesso" de outra pessoa — o gêmeo administrativo de
 * Minha conta > Segurança (`SecaoAcessos`, portal), sobre a conta de quem
 * está na URL. Duas perguntas, não uma: onde ela está logada AGORA (com
 * botão de encerrar por sessão, além do "revogar tudo" do menu de ações) e o
 * que aconteceu na conta recentemente (login, falha, troca de senha, 2FA).
 */
export function ModalHistoricoAcessoAgente({
  agente,
  onClose,
}: {
  agente: AgenteCfg | null
  onClose: () => void
}) {
  const aberto = agente !== null
  const userId = agente?.id ?? 0
  const historico = useHistoricoAcessoAgente(userId, aberto)
  const revogarSessao = useRevogarSessaoAgente(userId)
  const { push } = useToast()

  function encerrarSessao(key: string) {
    revogarSessao.mutate(key, {
      onError: (e) =>
        push({ tone: 'danger', title: 'Não foi possível encerrar a sessão', description: mensagemDeErro(e, '') }),
    })
  }

  return (
    <Modal
      open={aberto}
      onClose={onClose}
      title={agente ? `Histórico de acesso de ${agente.full_name}` : 'Histórico de acesso'}
      size="md"
    >
      {historico.isError ? (
        <ErrorState
          description={historico.error instanceof ApiError ? historico.error.detail : undefined}
          onRetry={() => historico.refetch()}
        />
      ) : historico.isLoading || !historico.data ? (
        <p>Carregando…</p>
      ) : (
        <div className="cfg-roster__historico">
          <section>
            <h3 className="cfg-roster__historico-titulo">
              Sessões ativas · {historico.data.sessions.length} de {historico.data.session_limit}
            </h3>
            {historico.data.sessions.length === 0 ? (
              <p className="cfg-meta-form">Nenhuma sessão ativa.</p>
            ) : (
              <ul className="cfg-roster__lista">
                {historico.data.sessions.map((s) => (
                  <li key={s.key} className="cfg-roster__historico-linha">
                    <div>
                      <div>{s.browser}</div>
                      <span className="cfg-meta-form">{s.ip || 'IP desconhecido'} · desde {s.started_at ? dataHora(s.started_at) : '—'}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => encerrarSessao(s.key)}
                      disabled={revogarSessao.isPending && revogarSessao.variables === s.key}
                    >
                      Encerrar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="cfg-roster__historico-titulo">Atividade recente</h3>
            {historico.data.events.length === 0 ? (
              <p className="cfg-meta-form">Nada por aqui ainda.</p>
            ) : (
              <ul className="cfg-roster__lista">
                {historico.data.events.map((ev, i) => (
                  <li key={`${ev.kind}-${ev.created_at}-${i}`} className="cfg-roster__historico-linha">
                    <div>
                      <div>
                        {ev.kind_label} {!ev.success && <Tag tone="danger">Falhou</Tag>}
                      </div>
                      <span className="cfg-meta-form">
                        {ev.browser} · {ev.ip || 'IP desconhecido'} · {dataHora(ev.created_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
