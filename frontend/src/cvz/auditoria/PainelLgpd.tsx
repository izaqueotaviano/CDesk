import { useState } from 'react'
import { Button, ErrorState, Modal, Tag, TextArea, useToast, type TagTone } from '@/cvz/components'
import { API_BASE_URL, ApiError } from '@/api/client'
import {
  useExecutarPedido,
  usePedidosLgpd,
  useRejeitarPedido,
  useVerificarPedido,
  type PedidoLgpd,
  type StatusPedidoLgpd,
} from './dados'

const ROTULO_STATUS: Record<StatusPedidoLgpd, { rotulo: string; tom: TagTone }> = {
  pending: { rotulo: 'Pendente', tom: 'away' },
  approved: { rotulo: 'Aprovado', tom: 'blue' },
  running: { rotulo: 'Em execução', tom: 'blue' },
  done: { rotulo: 'Concluído', tom: 'success' },
  failed: { rotulo: 'Falhou', tom: 'danger' },
  rejected: { rotulo: 'Rejeitado', tom: 'neutral' },
}

const ROTULO_TIPO: Record<string, string> = {
  export: 'Exportação',
  anonymize: 'Anonimização',
  rectify: 'Retificação',
}

function mensagemDeErro(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0] ?? padrao) : padrao
}

/** Confirma identidade (verify) ou registra o motivo da negativa (reject) —
 *  os dois pedem um texto obrigatório, então é o mesmo modal parametrizado. */
function ModalComJustificativa({
  open,
  onClose,
  titulo,
  rotuloCampo,
  confirmarRotulo,
  onConfirmar,
  pendente,
}: {
  open: boolean
  onClose: () => void
  titulo: string
  rotuloCampo: string
  confirmarRotulo: string
  onConfirmar: (texto: string) => Promise<unknown>
  pendente: boolean
}) {
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  async function confirmar() {
    if (!texto.trim()) {
      setErro('Campo obrigatório.')
      return
    }
    try {
      await onConfirmar(texto.trim())
      setTexto('')
      setErro(null)
      onClose()
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível concluir.'))
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setTexto('')
        setErro(null)
        onClose()
      }}
      title={titulo}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pendente}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={pendente}>
            {pendente ? 'Enviando…' : confirmarRotulo}
          </Button>
        </>
      }
    >
      <TextArea label={rotuloCampo} value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} autoFocus error={erro ?? undefined} />
    </Modal>
  )
}

function LinhaPedido({ pedido }: { pedido: PedidoLgpd }) {
  const { push } = useToast()
  const verificar = useVerificarPedido(pedido.id)
  const rejeitar = useRejeitarPedido(pedido.id)
  const executar = useExecutarPedido(pedido.id)
  const [modalAberto, setModalAberto] = useState<'verificar' | 'rejeitar' | null>(null)

  function executarAgora() {
    executar.mutate(undefined, {
      onSuccess: () => push({ tone: 'success', title: 'Execução disparada' }),
      onError: (e) => push({ tone: 'danger', title: 'Não foi possível executar', description: mensagemDeErro(e, '') }),
    })
  }

  const status = ROTULO_STATUS[pedido.status]
  const podeExecutar = ['pending', 'approved', 'failed'].includes(pedido.status)
  const podeRejeitar = ['pending', 'approved'].includes(pedido.status)
  const podeVerificar = pedido.kind === 'anonymize' && pedido.status === 'pending'

  return (
    <tr>
      <td>{pedido.subject_user_name ?? pedido.subject_company_name ?? '—'}</td>
      <td>{ROTULO_TIPO[pedido.kind] ?? pedido.kind}</td>
      <td>
        <Tag tone={status.tom} dot>
          {status.rotulo}
        </Tag>
      </td>
      <td>
        {pedido.is_overdue ? (
          <span style={{ color: 'var(--danger, #d33)' }}>Vencido</span>
        ) : pedido.days_left != null ? (
          `${pedido.days_left} dia(s)`
        ) : (
          '—'
        )}
      </td>
      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {podeVerificar && (
          <Button variant="ghost" size="sm" onClick={() => setModalAberto('verificar')}>
            Verificar identidade
          </Button>
        )}
        {podeExecutar && (
          <Button variant="ghost" size="sm" onClick={executarAgora} disabled={executar.isPending}>
            Executar
          </Button>
        )}
        {podeRejeitar && (
          <Button variant="ghost" size="sm" onClick={() => setModalAberto('rejeitar')}>
            Rejeitar
          </Button>
        )}
        {pedido.has_export && pedido.status === 'done' && (
          <a className="btn btn--ghost btn--sm" href={`${API_BASE_URL}/api/v1/audit/lgpd/${pedido.id}/download/`}>
            <span className="btn__label">Baixar pacote</span>
          </a>
        )}
      </td>

      <ModalComJustificativa
        open={modalAberto === 'verificar'}
        onClose={() => setModalAberto(null)}
        titulo="Confirmar identidade do titular"
        rotuloCampo="Como a identidade foi confirmada?"
        confirmarRotulo="Confirmar e aprovar"
        pendente={verificar.isPending}
        onConfirmar={(texto) => verificar.mutateAsync(texto)}
      />
      <ModalComJustificativa
        open={modalAberto === 'rejeitar'}
        onClose={() => setModalAberto(null)}
        titulo="Rejeitar pedido"
        rotuloCampo="Motivo da negativa (obrigatório pela LGPD)"
        confirmarRotulo="Rejeitar"
        pendente={rejeitar.isPending}
        onConfirmar={(texto) => rejeitar.mutateAsync(texto)}
      />
    </tr>
  )
}

/** Pedidos LGPD (export/anonimização) — exportação é self-service e já
 *  executa sozinha; anonimização passa por aqui (verificar → executar), ou
 *  é rejeitada com motivo (exigência legal). Criar um novo pedido de
 *  anonimização continua pelo /admin/ do Django por enquanto — ação rara e
 *  deliberada, sem tela própria ainda. */
export function PainelLgpd() {
  const pedidos = usePedidosLgpd()

  if (pedidos.isError) {
    return <ErrorState description={pedidos.error instanceof ApiError ? pedidos.error.detail : undefined} onRetry={() => pedidos.refetch()} />
  }

  return (
    <div className="auditoria-tabela__wrap">
      <table className="auditoria-tabela">
        <thead>
          <tr>
            <th>Titular</th>
            <th>Tipo</th>
            <th>Status</th>
            <th>Prazo</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {pedidos.isLoading ? (
            <tr>
              <td colSpan={5}>Carregando…</td>
            </tr>
          ) : pedidos.data && pedidos.data.length > 0 ? (
            pedidos.data.map((p) => <LinhaPedido key={p.id} pedido={p} />)
          ) : (
            <tr>
              <td colSpan={5}>Nenhum pedido LGPD registrado.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
