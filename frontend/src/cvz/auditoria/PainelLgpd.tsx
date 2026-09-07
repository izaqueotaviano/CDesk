import { useState } from 'react'
import { Button, ConfirmDialog, ErrorState, Modal, Tag, TextArea, useToast, type TagTone } from '@/cvz/components'
import { API_BASE_URL, ApiError } from '@/api/client'
import {
  useCandidatosRedacao,
  useExecutarPedido,
  usePedidosLgpd,
  useRedigirCampo,
  useRejeitarPedido,
  useVerificarPedido,
  type CandidatoRedacao,
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

const ROTULO_PADRAO_PII: Record<string, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  telefone: 'Telefone',
  cartao: 'Cartão',
}

const ROTULO_CAMPO_PII: Record<string, string> = {
  subject: 'Assunto do ticket',
  body: 'Corpo da mensagem',
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

/** Revisão de PII antes de anonimizar — o passo que faltava entre "identidade
 *  conferida" e "executar". Dois estágios, nunca sobrepostos: a lista de
 *  candidatos (onde dá para redigir campo a campo) e, só depois de o admin
 *  pedir para prosseguir, a barra de confirmação final — anonimizar é
 *  irreversível, então continua exigindo dois cliques deliberados, não um. */
function ModalRevisaoPii({
  pedido,
  onClose,
  executar,
}: {
  pedido: PedidoLgpd | null
  onClose: () => void
  executar: ReturnType<typeof useExecutarPedido>
}) {
  const aberto = pedido !== null
  const id = pedido?.id ?? 0
  const candidatos = useCandidatosRedacao(id, aberto)
  const redigir = useRedigirCampo(id)
  const { push } = useToast()
  const [confirmando, setConfirmando] = useState(false)

  function fechar() {
    setConfirmando(false)
    onClose()
  }

  async function redigirCandidato(c: CandidatoRedacao) {
    try {
      await redigir.mutateAsync({ model: c.model, pk: c.pk })
      push({ tone: 'success', title: 'Campo redigido' })
    } catch (e) {
      push({ tone: 'danger', title: 'Não foi possível redigir', description: mensagemDeErro(e, '') })
    }
  }

  async function confirmarExecucao() {
    await executar.mutateAsync(undefined, {
      onSuccess: () => push({ tone: 'success', title: 'Execução disparada' }),
      onError: (e) => push({ tone: 'danger', title: 'Não foi possível executar', description: mensagemDeErro(e, '') }),
    })
    fechar()
  }

  const lista = candidatos.data ?? []

  return (
    <>
      <Modal
        open={aberto && !confirmando}
        onClose={fechar}
        title="Revisar antes de anonimizar"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={fechar}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => setConfirmando(true)} disabled={candidatos.isLoading}>
              Prosseguir para execução
            </Button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          Campos estruturados (nome, e-mail, telefone) e anexos do titular são apagados automaticamente ao
          executar. O texto livre abaixo foi só sinalizado — confira cada item e redija o que for PII antes de
          seguir.
        </p>
        {candidatos.isError ? (
          <ErrorState
            description={candidatos.error instanceof ApiError ? candidatos.error.detail : undefined}
            onRetry={() => candidatos.refetch()}
          />
        ) : candidatos.isLoading ? (
          <p>Procurando PII em texto livre…</p>
        ) : lista.length === 0 ? (
          <p>Nenhum candidato encontrado em texto livre.</p>
        ) : (
          <ul className="lgpd-revisao__lista">
            {lista.map((c) => (
              <li key={`${c.model}-${c.pk}-${c.field}`} className="lgpd-revisao__item">
                <span>
                  <Tag tone="away">{ROTULO_PADRAO_PII[c.pattern] ?? c.pattern}</Tag> {c.reference} ·{' '}
                  {ROTULO_CAMPO_PII[c.field] ?? c.field}
                </span>
                <Button variant="ghost" size="sm" onClick={() => redigirCandidato(c)} disabled={redigir.isPending}>
                  Redigir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={aberto && confirmando}
        onClose={() => setConfirmando(false)}
        onConfirm={confirmarExecucao}
        title="Confirmar anonimização"
        description={
          lista.length > 0
            ? `${lista.length} trecho(s) de texto livre ainda não foram redigidos e serão mantidos como estão. Esta ação não pode ser desfeita.`
            : 'Esta ação não pode ser desfeita.'
        }
        confirmLabel="Executar agora"
        danger
      />
    </>
  )
}

function LinhaPedido({ pedido }: { pedido: PedidoLgpd }) {
  const { push } = useToast()
  const verificar = useVerificarPedido(pedido.id)
  const rejeitar = useRejeitarPedido(pedido.id)
  const executar = useExecutarPedido(pedido.id)
  const [modalAberto, setModalAberto] = useState<'verificar' | 'rejeitar' | null>(null)
  const [emRevisaoPii, setEmRevisaoPii] = useState(false)

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
  // anonimização é irreversível — passa pela revisão de PII antes de
  // executar; exportação/retificação não mexem em dado de terceiro do mesmo
  // jeito e seguem indo direto, como sempre foi.
  const exigeRevisaoPii = pedido.kind === 'anonymize'

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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (exigeRevisaoPii ? setEmRevisaoPii(true) : executarAgora())}
            disabled={executar.isPending}
          >
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
      {exigeRevisaoPii && (
        <ModalRevisaoPii pedido={emRevisaoPii ? pedido : null} onClose={() => setEmRevisaoPii(false)} executar={executar} />
      )}
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
