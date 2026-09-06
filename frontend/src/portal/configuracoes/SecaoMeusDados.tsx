import { Download, FileText } from 'lucide-react'
import { API_BASE_URL, ApiError } from '@/api/client'
import { useMeusPedidosDeDados, useSolicitarExportacao, type PedidoDeDados, type StatusPedidoDados } from '../api/conta'
import { cn } from '../lib/cn'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button, buttonVariants } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { Secao } from './Secao'

const ROTULO_STATUS: Record<StatusPedidoDados, { rotulo: string; tom: 'neutro' | 'acento' | 'ok' | 'alerta' | 'perigo' }> = {
  pending: { rotulo: 'Pendente', tom: 'alerta' },
  approved: { rotulo: 'Aprovado', tom: 'acento' },
  running: { rotulo: 'Preparando…', tom: 'acento' },
  done: { rotulo: 'Pronto', tom: 'ok' },
  failed: { rotulo: 'Falhou', tom: 'perigo' },
  rejected: { rotulo: 'Rejeitado', tom: 'perigo' },
}

function mensagem(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.detail ?? padrao) : padrao
}

function LinhaPedido({ pedido }: { pedido: PedidoDeDados }) {
  const status = ROTULO_STATUS[pedido.status]
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-divisoria bg-navegacao/60 px-4 py-3">
      <FileText className="size-5 shrink-0 text-tinta-secundaria" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-pequeno font-medio text-tinta">
          Exportação dos meus dados
          <Badge variant={status.tom} ponto>
            {status.rotulo}
          </Badge>
        </p>
        <p className="text-legenda text-tinta-secundaria">
          Pedida em {new Date(pedido.created_at).toLocaleDateString('pt-BR')}
          {pedido.status === 'rejected' && pedido.rejection_reason && ` — ${pedido.rejection_reason}`}
          {pedido.status === 'failed' && ' — não foi possível gerar o pacote, peça de novo'}
        </p>
      </div>
      {pedido.has_export && pedido.status === 'done' && (
        <a
          href={`${API_BASE_URL}/api/v1/audit/lgpd/${pedido.id}/download/`}
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
        >
          <Download /> Baixar
        </a>
      )}
    </div>
  )
}

/**
 * "Meus dados" (LGPD art. 18): pedir a exportação dos próprios dados é
 * self-service de verdade — a sessão autenticada já é a verificação de
 * identidade (`apps.audit.views.MyDataRequestView`), sem passar por
 * ninguém. Exclusão (anonimização) não tem botão aqui de propósito: é
 * irreversível e passa por um admin conferindo identidade — peça pelo
 * suporte.
 */
export function SecaoMeusDados() {
  const pedidos = useMeusPedidosDeDados()
  const solicitar = useSolicitarExportacao()

  const pedidoEmAndamento = pedidos.data?.some((p) => p.status === 'pending' || p.status === 'running' || p.status === 'approved')

  function pedir() {
    solicitar.mutate(undefined, {
      onSuccess: (pedido) => {
        if (pedido.status === 'done') toast.success('Exportação pronta — já pode baixar abaixo.')
        else toast.success('Pedido registrado. Avisamos quando estiver pronto.')
      },
      onError: (e) => toast.error(mensagem(e, 'Não foi possível pedir a exportação.')),
    })
  }

  return (
    <Secao
      id="meus-dados"
      icone={FileText}
      titulo="Meus dados"
      descricao="Peça uma cópia de tudo que temos sobre você — tickets, mensagens e anexos que só você (não a equipe) enviou."
    >
      <Button onClick={pedir} disabled={solicitar.isPending || pedidoEmAndamento} className="w-fit">
        {solicitar.isPending ? 'Pedindo…' : pedidoEmAndamento ? 'Exportação em andamento…' : 'Pedir exportação dos meus dados'}
      </Button>

      {pedidos.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : pedidos.isError ? (
        <Alert variant="destructive" titulo="Não foi possível carregar seus pedidos">
          {pedidos.error instanceof ApiError ? `Erro ${pedidos.error.status}.` : 'Verifique sua conexão.'}
        </Alert>
      ) : pedidos.data && pedidos.data.length > 0 ? (
        <div className="flex flex-col gap-2">
          {pedidos.data.map((p) => (
            <LinhaPedido key={p.id} pedido={p} />
          ))}
        </div>
      ) : null}
    </Secao>
  )
}
