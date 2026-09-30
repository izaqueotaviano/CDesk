import { useState } from 'react'
import { Checkbox, ErrorState, TextInput } from '@/cvz/components'
import { ApiError } from '@/api/client'
import { useLogsAcesso } from './dados'
import { LinhasCarregando, LinhaVazia } from './EstadoTabela'

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const ROTULO_CONTEXTO: Record<string, string> = {
  detail: 'Tela do ticket',
  export: 'Exportação',
  api: 'API',
  kanban: 'Quadro',
}

/**
 * Quem leu ticket de equipe restrita — inclusive tentativa negada. Diferente
 * do log de auditoria (que é sobre EDIÇÃO), este é sobre LEITURA: um agente
 * abrindo um ticket que não devia, mesmo sem alterar nada, fica registrado
 * (TicketAccessLog, apps/audit/models.py).
 */
export function PainelAcessos() {
  const [ticket, setTicket] = useState('')
  const [user, setUser] = useState('')
  const [apenasNegados, setApenasNegados] = useState(false)
  const acessos = useLogsAcesso({ ticket: ticket || undefined, user: user || undefined, apenasNegados })

  return (
    <div>
      <div className="auditoria-filtros">
        <TextInput label="ID do ticket" placeholder="Ex.: 128" value={ticket} onChange={(e) => setTicket(e.target.value.replace(/\D/g, ''))} />
        <TextInput label="ID do usuário" placeholder="Ex.: 42" value={user} onChange={(e) => setUser(e.target.value.replace(/\D/g, ''))} />
        <Checkbox checked={apenasNegados} onChange={(e) => setApenasNegados(e.target.checked)} label="Só tentativas negadas" />
      </div>

      {acessos.isError ? (
        <ErrorState description={acessos.error instanceof ApiError ? acessos.error.detail : undefined} onRetry={() => acessos.refetch()} />
      ) : (
        <div className="auditoria-tabela__wrap">
          <table className="auditoria-tabela">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Ticket</th>
                <th>Equipe</th>
                <th>Quem acessou</th>
                <th>De onde</th>
                <th>Resultado</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {acessos.isLoading ? (
                <LinhasCarregando colunas={7} />
              ) : acessos.data && acessos.data.results.length > 0 ? (
                acessos.data.results.map((a) => (
                  <tr key={a.id}>
                    <td>{formatarData(a.created_at)}</td>
                    <td>{a.ticket_reference}</td>
                    <td>{a.team ?? '—'}</td>
                    <td>{a.user_name}</td>
                    <td>{ROTULO_CONTEXTO[a.context] ?? a.context}</td>
                    <td className={a.was_granted ? undefined : 'auditoria-tabela__negado'}>
                      {a.was_granted ? 'Permitido' : 'Negado'}
                    </td>
                    <td>{a.ip_address || '—'}</td>
                  </tr>
                ))
              ) : (
                <LinhaVazia colunas={7}>
                  {ticket || user || apenasNegados
                    ? 'Nenhum acesso registrado para esse filtro.'
                    : 'Nenhuma leitura de chamado de equipe restrita registrada ainda.'}
                </LinhaVazia>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
