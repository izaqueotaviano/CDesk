import { useState } from 'react'
import { Button, ErrorState, Modal, Tag, TextArea, useToast, type TagTone } from '@/cvz/components'
import { ApiError } from '@/api/client'
import { useCiclosRetencao, useRevisarCiclo, useSimularRetencao, type CicloRetencao, type StatusCicloRetencao } from './dados'

const ROTULO_STATUS: Record<StatusCicloRetencao, { rotulo: string; tom: TagTone }> = {
  running: { rotulo: 'Em execução', tom: 'blue' },
  done: { rotulo: 'Concluído', tom: 'success' },
  failed: { rotulo: 'Falhou', tom: 'danger' },
}

function formatarData(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function mensagemDeErro(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.detail ?? padrao) : padrao
}

function ModalRevisao({ ciclo, onClose }: { ciclo: CicloRetencao | null; onClose: () => void }) {
  const [nota, setNota] = useState('')
  const revisar = useRevisarCiclo(ciclo?.id ?? 0)
  const { push } = useToast()

  async function confirmar() {
    try {
      await revisar.mutateAsync(nota.trim())
      push({ tone: 'success', title: 'Simulação marcada como revisada' })
      setNota('')
      onClose()
    } catch (e) {
      push({ tone: 'danger', title: 'Não foi possível revisar', description: mensagemDeErro(e, '') })
    }
  }

  return (
    <Modal
      open={ciclo !== null}
      onClose={onClose}
      title="Revisar simulação de retenção"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={revisar.isPending}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={revisar.isPending}>
            {revisar.isPending ? 'Enviando…' : 'Marcar como revisado'}
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        {ciclo?.total_matched ?? 0} registro(s) seriam apagados por esta política. Marcar como revisado é o que
        destrava o expurgo efetivo agendado — confira a amostra antes de confirmar.
      </p>
      <TextArea label="Observação (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} rows={3} autoFocus />
    </Modal>
  )
}

function LinhaCiclo({ ciclo, onRevisar }: { ciclo: CicloRetencao; onRevisar: () => void }) {
  const status = ROTULO_STATUS[ciclo.status]
  return (
    <tr>
      <td>{formatarData(ciclo.created_at)}</td>
      <td>
        <Tag tone={ciclo.dry_run ? 'neutral' : 'away'} dot>
          {ciclo.dry_run ? 'Simulação' : 'Expurgo efetivo'}
        </Tag>
      </td>
      <td>
        <Tag tone={status.tom} dot>
          {status.rotulo}
        </Tag>
      </td>
      <td>{ciclo.triggered_by_name}</td>
      <td>{ciclo.total_matched}</td>
      <td>{ciclo.total_applied}</td>
      <td>
        {!ciclo.dry_run ? (
          '—'
        ) : ciclo.is_reviewed ? (
          <span title={ciclo.review_note || undefined}>
            {ciclo.reviewed_by_name} em {formatarData(ciclo.reviewed_at)}
          </span>
        ) : (
          <Button variant="ghost" size="sm" onClick={onRevisar}>
            Revisar
          </Button>
        )}
      </td>
    </tr>
  )
}

/**
 * Ciclos de retenção (D18) — sem esta tela, "simular antes de ligar o
 * expurgo de verdade" seria uma linha de log que ninguém lê. Não existe
 * botão de "rodar expurgo agora": o efetivo só roda pelo agendamento
 * (`services/retention.py::run`), e só depois que alguma simulação foi
 * revisada aqui — a trava é de propósito (ver `_blocking_reason`).
 */
export function PainelRetencao() {
  const ciclos = useCiclosRetencao()
  const simular = useSimularRetencao()
  const [emRevisao, setEmRevisao] = useState<CicloRetencao | null>(null)
  const { push } = useToast()

  function rodarSimulacao() {
    simular.mutate(undefined, {
      onSuccess: () => push({ tone: 'success', title: 'Simulação concluída' }),
      onError: (e) => push({ tone: 'danger', title: 'Não foi possível simular', description: mensagemDeErro(e, '') }),
    })
  }

  return (
    <div>
      <p>
        Uma simulação não apaga nada — só mostra o que a política de retenção apagaria. O expurgo efetivo roda
        sozinho pelo agendamento, e só depois que uma simulação for revisada abaixo.
      </p>
      <div style={{ marginBottom: 16 }}>
        <Button onClick={rodarSimulacao} disabled={simular.isPending}>
          {simular.isPending ? 'Simulando…' : 'Rodar simulação agora'}
        </Button>
      </div>

      {ciclos.isError ? (
        <ErrorState description={ciclos.error instanceof ApiError ? ciclos.error.detail : undefined} onRetry={() => ciclos.refetch()} />
      ) : (
        <div className="auditoria-tabela__wrap">
          <table className="auditoria-tabela">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Disparado por</th>
                <th>Encontrados</th>
                <th>Aplicados</th>
                <th>Revisão</th>
              </tr>
            </thead>
            <tbody>
              {ciclos.isLoading ? (
                <tr>
                  <td colSpan={7}>Carregando…</td>
                </tr>
              ) : ciclos.data && ciclos.data.length > 0 ? (
                ciclos.data.map((c) => <LinhaCiclo key={c.id} ciclo={c} onRevisar={() => setEmRevisao(c)} />)
              ) : (
                <tr>
                  <td colSpan={7}>Nenhum ciclo de retenção rodou ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ModalRevisao ciclo={emRevisao} onClose={() => setEmRevisao(null)} />
    </div>
  )
}
